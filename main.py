from __future__ import annotations

import asyncio
import os
import pickle
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sklearn.metrics.pairwise import linear_kernel


# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()
TMDB_ACCESS_TOKEN = os.getenv("TMDB_ACCESS_TOKEN", "").strip()

TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"

# Keep the first screen light and fast.
HOME_LIMIT = 12
TRENDING_LIMIT = 12
POPULAR_LIMIT = 12
TOP_RATED_LIMIT = 12
ANIMATION_LIMIT = 12
SEARCH_LIMIT = 12
RECOMMEND_LIMIT = 11

# Cache durations in seconds.
CACHE_TTL_HOME = 600
CACHE_TTL_TRENDING = 600
CACHE_TTL_POPULAR = 600
CACHE_TTL_TOP_RATED = 900
CACHE_TTL_ANIMATION = 900
CACHE_TTL_SEARCH = 300
CACHE_TTL_DETAILS = 3600
CACHE_TTL_RECOMMEND = 3600

# TMDB can occasionally return 503/502/504 or timeout.
TMDB_RETRIES = 3
TMDB_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Limit concurrent TMDB calls so recommendations do not hammer the API.
TMDB_CONCURRENCY = 5
tmdb_semaphore = asyncio.Semaphore(TMDB_CONCURRENCY)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# ============================================================
# MODEL LOADING
# ============================================================

def load_pickle(filename: str) -> Any:
    path = BASE_DIR / filename

    if not path.exists():
        raise FileNotFoundError(
            f"{filename} not found. Put {filename} beside main.py."
        )

    with path.open("rb") as file:
        return pickle.load(file)


MODEL_ERROR: str | None = None
df = pd.DataFrame()
indices = None
tfidf_matrix = None
tfidf = None

try:
    df = load_pickle("df.pkl")
    indices = load_pickle("indices.pkl")
    tfidf_matrix = load_pickle("tfidf_matrix.pkl")
    tfidf = load_pickle("tfidf.pkl")
except Exception as exc:
    MODEL_ERROR = str(exc)


# ============================================================
# CACHE
# ============================================================

# key -> (expires_at, value)
_cache: dict[str, tuple[float, Any]] = {}

# Keeps the last successful value even after normal TTL expiry.
# This lets the website still show something if TMDB has a
# temporary outage.
_stale_cache: dict[str, Any] = {}


def cache_get(key: str) -> Any | None:
    item = _cache.get(key)

    if item is None:
        return None

    expires_at, value = item

    if time.monotonic() >= expires_at:
        _cache.pop(key, None)
        return None

    return value


def stale_get(key: str) -> Any | None:
    return _stale_cache.get(key)


def cache_set(key: str, value: Any, ttl: int) -> None:
    _cache[key] = (
        time.monotonic() + ttl,
        value,
    )
    _stale_cache[key] = value


# ============================================================
# HTTP CLIENT
# ============================================================

client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client

    client = httpx.AsyncClient(
        base_url=TMDB_BASE_URL,
        timeout=httpx.Timeout(
            10.0,
            connect=4.0,
        ),
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=10,
        ),
        headers={
            "accept": "application/json",
            "user-agent": "MovieMind/2.1",
        },
    )

    yield

    await client.aclose()
    client = None


app = FastAPI(
    title="MovieMind",
    description=(
        "TMDB-powered movie discovery with a local "
        "TF-IDF recommendation model."
    ),
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(
        directory=str(BASE_DIR / "static")
    ),
    name="static",
)


# ============================================================
# TMDB
# ============================================================

def require_tmdb() -> None:
    if not TMDB_API_KEY and not TMDB_ACCESS_TOKEN:
        raise HTTPException(
            status_code=500,
            detail=(
                "TMDB credentials are missing. "
                "Add TMDB_API_KEY to .env."
            ),
        )


def tmdb_headers() -> dict[str, str]:
    headers = {
        "accept": "application/json",
    }

    # Bearer token is supported if you decide to use it later.
    if TMDB_ACCESS_TOKEN:
        headers["Authorization"] = (
            f"Bearer {TMDB_ACCESS_TOKEN}"
        )

    return headers


async def tmdb_get(
    endpoint: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Reliable TMDB GET:
    - timeout
    - retry for temporary 5xx/429
    - retry for connection errors
    - API key or Bearer authentication
    """

    require_tmdb()

    if client is None:
        raise HTTPException(
            status_code=503,
            detail="TMDB client is not ready.",
        )

    query = dict(params or {})

    # v3 API key authentication.
    # If Bearer token is supplied, it is used instead.
    if TMDB_ACCESS_TOKEN:
        query.pop("api_key", None)
    else:
        query["api_key"] = TMDB_API_KEY

    last_error: Exception | None = None

    for attempt in range(TMDB_RETRIES):
        try:
            async with tmdb_semaphore:
                response = await client.get(
                    endpoint,
                    params=query,
                    headers=tmdb_headers(),
                )

            status = response.status_code

            if status == 200:
                try:
                    return response.json()
                except ValueError as exc:
                    last_error = exc

            elif status == 401:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "TMDB authentication failed. "
                        "Check TMDB_API_KEY in .env."
                    ),
                )

            elif status == 404:
                raise HTTPException(
                    status_code=404,
                    detail="TMDB resource not found.",
                )

            elif status == 422:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "TMDB rejected the request parameters."
                    ),
                )

            elif status in TMDB_RETRYABLE_STATUS:
                retry_after = response.headers.get(
                    "Retry-After"
                )

                if retry_after:
                    try:
                        delay = min(
                            float(retry_after),
                            4.0,
                        )
                    except ValueError:
                        delay = 0.8 * (2 ** attempt)
                else:
                    delay = 0.8 * (2 ** attempt)

                if attempt < TMDB_RETRIES - 1:
                    await asyncio.sleep(delay)
                    continue

                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"TMDB is temporarily unavailable "
                        f"(HTTP {status}). Please try again."
                    ),
                )

            else:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"TMDB returned HTTP {status}."
                    ),
                )

        except HTTPException:
            raise

        except (
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ConnectError,
            httpx.ReadError,
            httpx.RemoteProtocolError,
        ) as exc:
            last_error = exc

            if attempt < TMDB_RETRIES - 1:
                await asyncio.sleep(
                    0.8 * (2 ** attempt)
                )
                continue

        except httpx.RequestError as exc:
            last_error = exc

            if attempt < TMDB_RETRIES - 1:
                await asyncio.sleep(
                    0.8 * (2 ** attempt)
                )
                continue

    raise HTTPException(
        status_code=503,
        detail=(
            "TMDB could not be reached after "
            f"{TMDB_RETRIES} attempts."
        ),
    ) from last_error


# ============================================================
# MOVIE HELPERS
# ============================================================

GENRE_MAP = {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    99: "Documentary",
    18: "Drama",
    10751: "Family",
    14: "Fantasy",
    36: "History",
    27: "Horror",
    10402: "Music",
    9648: "Mystery",
    10749: "Romance",
    878: "Science Fiction",
    10770: "TV Movie",
    53: "Thriller",
    10752: "War",
    37: "Western",
}


def image_url(
    path: str | None,
    size: str = "w500",
) -> str | None:
    if not path:
        return None

    return f"{TMDB_IMAGE_BASE}/{size}{path}"


def release_year(
    date_value: str | None,
) -> str:
    if date_value and len(date_value) >= 4:
        return date_value[:4]

    return "N/A"


def safe_rating(value: Any) -> float:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return 0.0


def genre_names(
    movie: dict[str, Any],
) -> list[str]:
    genres = movie.get("genres") or []

    if genres and isinstance(
        genres[0],
        dict,
    ):
        return [
            str(genre.get("name"))
            for genre in genres
            if genre.get("name")
        ]

    genre_ids = movie.get("genre_ids") or []

    return [
        GENRE_MAP[int(genre_id)]
        for genre_id in genre_ids
        if str(genre_id).isdigit()
        and int(genre_id) in GENRE_MAP
    ]


def clean_movie(
    movie: dict[str, Any],
) -> dict[str, Any]:
    release_date = (
        movie.get("release_date")
        or movie.get("first_air_date")
        or ""
    )

    return {
        "tmdb_id": movie.get("id"),
        "title": (
            movie.get("title")
            or movie.get("original_title")
            or "Unknown Movie"
        ),
        "overview": (
            movie.get("overview")
            or "No overview available."
        ),
        "tagline": movie.get("tagline") or "",
        "poster": image_url(
            movie.get("poster_path"),
            "w500",
        ),
        "poster_large": image_url(
            movie.get("poster_path"),
            "w780",
        ),
        "backdrop": image_url(
            movie.get("backdrop_path"),
            "w1280",
        ),
        "rating": safe_rating(
            movie.get("vote_average")
        ),
        "release_date": release_date,
        "year": release_year(
            release_date
        ),
        "genres": genre_names(movie),
        "popularity": movie.get(
            "popularity",
            0,
        ),
        "runtime": movie.get(
            "runtime"
        ),
        "language": movie.get(
            "original_language"
        ),
    }


def normalize_title(
    value: str,
) -> str:
    value = str(
        value or ""
    ).lower().strip()

    value = re.sub(
        r"[^a-z0-9\s]",
        " ",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value


# ============================================================
# MODEL HELPERS
# ============================================================

def find_model_index(
    title: str,
):
    if (
        df.empty
        or indices is None
    ):
        return None

    wanted = normalize_title(
        title
    )

    if isinstance(
        indices,
        pd.Series,
    ):
        exact_matches = []

        for raw_title, raw_index in indices.items():
            if (
                normalize_title(raw_title)
                == wanted
            ):
                try:
                    exact_matches.append(
                        int(raw_index)
                    )
                except (
                    TypeError,
                    ValueError,
                ):
                    continue

        if exact_matches:
            return exact_matches[0]

        for raw_title, raw_index in indices.items():
            normalized = normalize_title(
                raw_title
            )

            if (
                wanted
                and (
                    wanted in normalized
                    or normalized in wanted
                )
            ):
                try:
                    return int(raw_index)
                except (
                    TypeError,
                    ValueError,
                ):
                    continue

    if isinstance(
        indices,
        dict,
    ):
        for raw_title, raw_index in indices.items():
            if (
                normalize_title(raw_title)
                == wanted
            ):
                try:
                    return int(raw_index)
                except (
                    TypeError,
                    ValueError,
                ):
                    continue

    if "title" in df.columns:
        normalized_titles = (
            df["title"]
            .astype(str)
            .map(normalize_title)
        )

        matches = df.index[
            normalized_titles == wanted
        ].tolist()

        if matches:
            return int(matches[0])

    return None


async def tmdb_search_one(
    title: str,
) -> dict[str, Any] | None:
    try:
        data = await tmdb_get(
            "/search/movie",
            {
                "query": title,
                "language": "en-US",
                "include_adult": "false",
                "page": 1,
            },
        )
    except HTTPException:
        return None

    results = data.get(
        "results"
    ) or []

    if not results:
        return None

    wanted = normalize_title(
        title
    )

    for movie in results:
        if (
            normalize_title(
                movie.get("title", "")
            )
            == wanted
        ):
            return movie

    return results[0]


# ============================================================
# PAGES
# ============================================================

@app.get(
    "/",
    response_class=HTMLResponse,
)
async def index(
    request: Request,
):
    return templates.TemplateResponse(
        "index.html",
        {"request": request},
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tmdb_configured": bool(
            TMDB_API_KEY
            or TMDB_ACCESS_TOKEN
        ),
        "model_loaded": (
            MODEL_ERROR is None
        ),
        "model_error": MODEL_ERROR,
        "movies_in_model": (
            int(len(df))
            if not df.empty
            else 0
        ),
    }


# ============================================================
# DISCOVERY GENERIC HELPER
# ============================================================

async def discover_movies(
    cache_key: str,
    endpoint: str,
    params: dict[str, Any],
    limit: int,
    ttl: int,
) -> dict[str, Any]:
    cached = cache_get(
        cache_key
    )

    if cached is not None:
        return cached

    try:
        data = await tmdb_get(
            endpoint,
            params,
        )
    except HTTPException as exc:
        stale = stale_get(
            cache_key
        )

        if stale is not None:
            return stale

        raise exc

    movies: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    for movie in (
        data.get("results") or []
    ):
        movie_id = movie.get("id")

        if (
            not movie_id
            or movie_id in seen_ids
        ):
            continue

        if not movie.get(
            "poster_path"
        ):
            continue

        seen_ids.add(
            movie_id
        )

        movies.append(
            clean_movie(movie)
        )

        if len(movies) >= limit:
            break

    payload = {
        "movies": movies,
        "count": len(movies),
    }

    cache_set(
        cache_key,
        payload,
        ttl,
    )

    return payload


# ============================================================
# HOME
# ============================================================

@app.get("/api/home")
async def home(
    page: int = Query(
        1,
        ge=1,
        le=500,
    ),
):
    return await discover_movies(
        cache_key=f"home:{page}",
        endpoint="/discover/movie",
        params={
            "language": "en-US",
            "include_adult": "false",
            "include_video": "false",
            "sort_by": "popularity.desc",
            "vote_count.gte": 100,
            "page": page,
        },
        limit=HOME_LIMIT,
        ttl=CACHE_TTL_HOME,
    )


# ============================================================
# TRENDING
# ============================================================

@app.get("/api/trending")
async def trending():
    return await discover_movies(
        cache_key="trending",
        endpoint="/trending/movie/week",
        params={
            "language": "en-US",
        },
        limit=TRENDING_LIMIT,
        ttl=CACHE_TTL_TRENDING,
    )


# ============================================================
# POPULAR
# ============================================================

@app.get("/api/popular")
async def popular(
    page: int = Query(
        1,
        ge=1,
        le=500,
    ),
):
    return await discover_movies(
        cache_key=f"popular:{page}",
        endpoint="/movie/popular",
        params={
            "language": "en-US",
            "region": "US",
            "page": page,
        },
        limit=POPULAR_LIMIT,
        ttl=CACHE_TTL_POPULAR,
    )


# ============================================================
# TOP RATED
# ============================================================

@app.get("/api/top-rated")
async def top_rated(
    page: int = Query(
        1,
        ge=1,
        le=500,
    ),
):
    return await discover_movies(
        cache_key=f"top-rated:{page}",
        endpoint="/movie/top_rated",
        params={
            "language": "en-US",
            "region": "US",
            "page": page,
        },
        limit=TOP_RATED_LIMIT,
        ttl=CACHE_TTL_TOP_RATED,
    )


# ============================================================
# ANIMATION
# ============================================================

@app.get("/api/animation")
async def animation(
    page: int = Query(
        1,
        ge=1,
        le=500,
    ),
):
    return await discover_movies(
        cache_key=f"animation:{page}",
        endpoint="/discover/movie",
        params={
            "language": "en-US",
            "include_adult": "false",
            "include_video": "false",
            "sort_by": "popularity.desc",
            "with_genres": "16",
            "vote_count.gte": 50,
            "page": page,
        },
        limit=ANIMATION_LIMIT,
        ttl=CACHE_TTL_ANIMATION,
    )


# ============================================================
# SEARCH
# ============================================================

@app.get("/api/search")
async def search(
    q: str = Query(
        ...,
        min_length=1,
        max_length=100,
    ),
):
    query = q.strip()

    if not query:
        raise HTTPException(
            status_code=422,
            detail="Search query cannot be empty.",
        )

    key = (
        f"search:{query.casefold()}"
    )

    cached = cache_get(key)

    if cached is not None:
        return cached

    try:
        data = await tmdb_get(
            "/search/movie",
            {
                "query": query,
                "language": "en-US",
                "include_adult": "false",
                "page": 1,
            },
        )
    except HTTPException as exc:
        stale = stale_get(key)

        if stale is not None:
            return stale

        raise exc

    movies = [
        clean_movie(movie)
        for movie in (
            data.get("results")
            or []
        )
        if movie.get(
            "poster_path"
        )
    ][:SEARCH_LIMIT]

    payload = {
        "query": query,
        "movies": movies,
        "count": len(movies),
    }

    cache_set(
        key,
        payload,
        CACHE_TTL_SEARCH,
    )

    return payload


# ============================================================
# MOVIE DETAILS
# ============================================================

@app.get("/api/movie/{tmdb_id}")
async def movie_details(
    tmdb_id: int,
):
    key = (
        f"details:{tmdb_id}"
    )

    cached = cache_get(key)

    if cached is not None:
        return cached

    try:
        # One TMDB request instead of three separate
        # requests for details + credits + videos.
        details = await tmdb_get(
            f"/movie/{tmdb_id}",
            {
                "language": "en-US",
                "append_to_response": (
                    "credits,videos"
                ),
            },
        )
    except HTTPException as exc:
        stale = stale_get(key)

        if stale is not None:
            return stale

        raise exc

    movie = clean_movie(
        details
    )

    credits = (
        details.get("credits")
        or {}
    )

    videos = (
        details.get("videos")
        or {}
    )

    cast = []

    for person in (
        credits.get("cast")
        or []
    )[:8]:
        name = person.get(
            "name"
        )

        if not name:
            continue

        cast.append(
            {
                "name": name,
                "character": (
                    person.get(
                        "character"
                    )
                    or ""
                ),
                "profile": image_url(
                    person.get(
                        "profile_path"
                    ),
                    "w185",
                ),
            }
        )

    director = None

    for person in (
        credits.get("crew")
        or []
    ):
        if (
            person.get("job")
            == "Director"
        ):
            director = person.get(
                "name"
            )
            break

    trailer_key = None

    for video in (
        videos.get("results")
        or []
    ):
        if (
            video.get("site")
            == "YouTube"
            and video.get("type")
            in {"Trailer", "Teaser"}
            and video.get("key")
        ):
            trailer_key = video.get(
                "key"
            )

            if (
                video.get("type")
                == "Trailer"
            ):
                break

    movie.update(
        {
            "cast": cast,
            "director": director,
            "trailer_key": trailer_key,
            "homepage": details.get(
                "homepage"
            ),
            "budget": details.get(
                "budget"
            ),
            "revenue": details.get(
                "revenue"
            ),
            "status": details.get(
                "status"
            ),
            "vote_count": details.get(
                "vote_count"
            ),
        }
    )

    cache_set(
        key,
        movie,
        CACHE_TTL_DETAILS,
    )

    return movie


# ============================================================
# TF-IDF RECOMMENDATIONS
# ============================================================

@app.get("/api/recommendations")
async def recommendations(
    title: str = Query(
        ...,
        min_length=1,
        max_length=200,
    ),
):
    if MODEL_ERROR is not None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Recommendation model could not "
                f"be loaded: {MODEL_ERROR}"
            ),
        )

    if (
        df.empty
        or tfidf_matrix is None
    ):
        raise HTTPException(
            status_code=500,
            detail=(
                "Recommendation model is empty."
            ),
        )

    key = (
        "recommend:"
        + normalize_title(title)
    )

    cached = cache_get(key)

    if cached is not None:
        return cached

    movie_index = find_model_index(
        title
    )

    if movie_index is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f'"{title}" was not found '
                "in the recommendation model."
            ),
        )

    try:
        scores = linear_kernel(
            tfidf_matrix[
                movie_index:
                movie_index + 1
            ],
            tfidf_matrix,
        ).flatten()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not calculate "
                f"recommendations: {exc}"
            ),
        ) from exc

    ranked_indices = scores.argsort()[
        ::-1
    ]

    local_titles: list[str] = []
    selected_normalized = (
        normalize_title(title)
    )

    for idx in ranked_indices:
        idx = int(idx)

        if idx == int(movie_index):
            continue

        if idx >= len(df):
            continue

        raw_title = str(
            df.iloc[idx].get(
                "title",
                "",
            )
        ).strip()

        if not raw_title:
            continue

        if (
            normalize_title(
                raw_title
            )
            == selected_normalized
        ):
            continue

        if raw_title not in local_titles:
            local_titles.append(
                raw_title
            )

        if (
            len(local_titles)
            >= RECOMMEND_LIMIT
        ):
            break

    # Search the recommendation titles on TMDB
    # concurrently, but with a semaphore to avoid
    # unnecessary request bursts.
    tmdb_results = await asyncio.gather(
        *(
            tmdb_search_one(
                movie_title
            )
            for movie_title
            in local_titles
        ),
        return_exceptions=True,
    )

    movies = []
    seen_ids: set[int] = set()

    for result in tmdb_results:
        if (
            isinstance(
                result,
                Exception,
            )
            or result is None
        ):
            continue

        movie_id = result.get(
            "id"
        )

        if (
            not movie_id
            or movie_id in seen_ids
        ):
            continue

        if not result.get(
            "poster_path"
        ):
            continue

        seen_ids.add(
            movie_id
        )

        movies.append(
            clean_movie(result)
        )

        if (
            len(movies)
            >= RECOMMEND_LIMIT
        ):
            break

    payload = {
        "based_on": title,
        "movies": movies,
        "count": len(movies),
    }

    cache_set(
        key,
        payload,
        CACHE_TTL_RECOMMEND,
    )

    return payload


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )