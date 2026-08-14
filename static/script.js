"use strict";

/* =========================================================
   MOVIEMIND — FINAL SCRIPT
   Existing design preserved
   Sections:
   Popular → Top Rated → Animation → Trending
   Automatic AI recommendations inside movie modal
   ========================================================= */

const API = "/api";

const state = {
    currentMovie: null,
    movieController: null,
    recommendationController: null,
    searchController: null,
    requestCache: new Map(),
    recommendationRequestId: 0,
    toastTimer: null
};


/* =========================================================
   DOM
   ========================================================= */

function $(selector) {
    return document.querySelector(selector);
}


/* =========================================================
   HTML SAFETY
   ========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   ERROR
   ========================================================= */

function friendlyError(error) {
    if (!error) {
        return "Something went wrong.";
    }

    if (error.name === "AbortError") {
        return "Request cancelled.";
    }

    return error.message || "Something went wrong.";
}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {
    const toast = $("#toast");

    if (!toast) {
        return;
    }

    toast.textContent = message || "Something went wrong.";
    toast.classList.add("show");

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


/* =========================================================
   LOADING
   ========================================================= */

function showLoading() {
    $("#loading")?.classList.remove("hidden");
}

function hideLoading() {
    $("#loading")?.classList.add("hidden");
}


/* =========================================================
   API REQUEST
   ========================================================= */

async function apiRequest(url, options = {}) {

    if (
        !options.noCache &&
        state.requestCache.has(url)
    ) {
        return state.requestCache.get(url);
    }

    const request = fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json"
        },
        signal: options.signal
    })
        .then(async response => {

            let data = null;

            try {
                data = await response.json();
            } catch {
                throw new Error(
                    "Server returned invalid JSON."
                );
            }

            if (!response.ok) {
                throw new Error(
                    data?.detail ||
                    `Request failed with status ${response.status}.`
                );
            }

            return data;
        });

    if (!options.noCache) {
        state.requestCache.set(url, request);
    }

    try {
        return await request;
    } catch (error) {
        state.requestCache.delete(url);
        throw error;
    }
}


/* =========================================================
   TEXT
   ========================================================= */

function setText(
    selector,
    value,
    fallback = "—"
) {
    const element = $(selector);

    if (!element) {
        return;
    }

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        element.textContent = fallback;
        return;
    }

    element.textContent = value;
}


/* =========================================================
   MOVIE NORMALIZER
   ========================================================= */

function normalizeMovie(movie) {

    if (!movie || typeof movie !== "object") {
        return null;
    }

    const id = Number(
        movie.tmdb_id ??
        movie.id ??
        0
    );

    if (!id) {
        return null;
    }

    return {
        tmdb_id: id,

        title:
            movie.title ||
            movie.name ||
            "Unknown Movie",

        poster:
            movie.poster ||
            movie.poster_large ||
            "",

        poster_large:
            movie.poster_large ||
            movie.poster ||
            "",

        backdrop:
            movie.backdrop ||
            "",

        rating:
            Number(movie.rating || 0),

        year:
            movie.year ||
            movie.release_year ||
            (
                movie.release_date
                    ? String(movie.release_date).slice(0, 4)
                    : "N/A"
            ),

        runtime:
            movie.runtime || null,

        overview:
            movie.overview ||
            "No overview available.",

        tagline:
            movie.tagline ||
            "",

        genres:
            Array.isArray(movie.genres)
                ? movie.genres
                : [],

        director:
            movie.director ||
            (
                Array.isArray(movie.directors)
                    ? movie.directors.join(", ")
                    : ""
            ),

        cast:
            Array.isArray(movie.cast)
                ? movie.cast
                : [],

        trailer_key:
            movie.trailer_key ||
            null
    };
}


/* =========================================================
   SKELETON
   ========================================================= */

function createSkeletons(count = 11) {

    return Array.from(
        { length: count },
        () => `
            <div class="skeleton"></div>
        `
    ).join("");
}


/* =========================================================
   MOVIE CARD
   ========================================================= */

function createMovieCard(movie) {

    const item = normalizeMovie(movie);

    if (
        !item ||
        !item.tmdb_id ||
        !item.poster
    ) {
        return "";
    }

    const title = escapeHtml(item.title);
    const poster = escapeHtml(item.poster);

    const rating =
        Number.isFinite(item.rating)
            ? item.rating.toFixed(1)
            : "0.0";

    const year =
        escapeHtml(item.year || "N/A");

    return `
        <article
            class="movie-card"
            data-movie-id="${item.tmdb_id}"
            tabindex="0"
            role="button"
            aria-label="Open ${title}"
        >

            <div class="poster-wrap">

                <img
                    class="poster"
                    src="${poster}"
                    alt="${title} poster"
                    loading="lazy"
                    onerror="this.style.display='none'"
                >

                <span class="rating-badge">
                    ★ ${rating}
                </span>

                <div class="poster-overlay">
                    <span class="view-label">
                        View Details →
                    </span>
                </div>

            </div>

            <div class="card-info">

                <h3
                    class="card-title"
                    title="${title}"
                >
                    ${title}
                </h3>

                <div class="card-meta">
                    <span>${year}</span>
                    <span>•</span>
                    <span>TMDB</span>
                </div>

            </div>

        </article>
    `;
}


/* =========================================================
   RENDER
   ========================================================= */

function renderMovies(container, movies) {

    if (!container) {
        return;
    }

    const list = Array.isArray(movies)
        ? movies
            .map(normalizeMovie)
            .filter(Boolean)
        : [];

    if (!list.length) {

        container.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:30px 0;
                    color:#6b7280;
                "
            >
                No movies found.
            </div>
        `;

        return;
    }

    container.innerHTML = list
        .map(createMovieCard)
        .filter(Boolean)
        .join("");
}


/* =========================================================
   CREATE EXTRA SECTIONS
   IMPORTANT:
   No HTML/CSS replacement.
   Uses your existing section/movie-grid design.
   ========================================================= */

function createExtraMovieSections() {

    const popularSection =
        document.querySelector("#popular");

    const trendingSection =
        document.querySelector("#trending");

    if (!popularSection || !trendingSection) {
        return;
    }

    /* Prevent duplicate sections */
    if (
        document.querySelector("#topRated") ||
        document.querySelector("#animation")
    ) {
        return;
    }

    const topRated = document.createElement("section");

    topRated.className = "section";
    topRated.id = "topRated";

    topRated.innerHTML = `
        <div class="container">

            <div class="section-heading">
                <div>
                    <span class="section-kicker">
                        ⭐ TOP RATED
                    </span>

                    <h2>Top Rated Movies</h2>

                    <p>
                        Highly rated movies loved by audiences.
                    </p>
                </div>
            </div>

            <div
                class="movie-grid"
                id="topRatedGrid"
            >
                ${createSkeletons(12)}
            </div>

        </div>
    `;


    const animation = document.createElement("section");

    animation.className = "section";

    animation.id = "animation";

    animation.innerHTML = `
        <div class="container">

            <div class="section-heading">
                <div>

                    <span class="section-kicker">
                        🎬 ANIMATION
                    </span>

                    <h2>Animation Movies</h2>

                    <p>
                        Animated movies worth watching.
                    </p>

                </div>
            </div>

            <div
                class="movie-grid"
                id="animationGrid"
            >
                ${createSkeletons(12)}
            </div>

        </div>
    `;


    /*
       Exact order:

       Popular
       ↓
       Top Rated
       ↓
       Animation
       ↓
       Trending
    */

    popularSection.insertAdjacentElement(
        "afterend",
        topRated
    );

    topRated.insertAdjacentElement(
        "afterend",
        animation
    );
}


/* =========================================================
   POPULAR
   ========================================================= */

async function loadHomeMovies() {

    const grid = $("#homeGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML =
        createSkeletons(12);

    try {

        const data =
            await apiRequest(
                `${API}/home`
            );

        renderMovies(
            grid,
            data?.movies || []
        );

    } catch (error) {

        console.error(
            "Popular movies error:",
            error
        );

        grid.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:30px 0;
                    color:#6b7280;
                "
            >
                Unable to load popular movies.
            </div>
        `;
    }
}


/* =========================================================
   TOP RATED
   ========================================================= */

async function loadTopRatedMovies() {

    const grid =
        $("#topRatedGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML =
        createSkeletons(12);

    try {

        const data =
            await apiRequest(
                `${API}/top-rated`
            );

        renderMovies(
            grid,
            data?.movies || []
        );

    } catch (error) {

        console.error(
            "Top rated error:",
            error
        );

        grid.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:30px 0;
                    color:#6b7280;
                "
            >
                Unable to load top rated movies.
            </div>
        `;
    }
}


/* =========================================================
   ANIMATION
   ========================================================= */

async function loadAnimationMovies() {

    const grid =
        $("#animationGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML =
        createSkeletons(12);

    try {

        const data =
            await apiRequest(
                `${API}/animation`
            );

        renderMovies(
            grid,
            data?.movies || []
        );

    } catch (error) {

        console.error(
            "Animation movies error:",
            error
        );

        grid.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:30px 0;
                    color:#6b7280;
                "
            >
                Unable to load animation movies.
            </div>
        `;
    }
}


/* =========================================================
   TRENDING
   ========================================================= */

async function loadTrendingMovies() {

    const grid =
        $("#trendingGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML =
        createSkeletons(12);

    try {

        const data =
            await apiRequest(
                `${API}/trending`
            );

        renderMovies(
            grid,
            data?.movies || []
        );

    } catch (error) {

        console.error(
            "Trending error:",
            error
        );

        grid.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:30px 0;
                    color:#6b7280;
                "
            >
                Unable to load trending movies.
            </div>
        `;
    }
}


/* =========================================================
   SEARCH
   ========================================================= */

async function searchMovies() {

    const input =
        $("#searchInput");

    if (!input) {
        return;
    }

    const query =
        input.value.trim();

    if (!query) {

        $("#searchSection")
            ?.classList.add("hidden");

        return;
    }

    if (state.searchController) {
        state.searchController.abort();
    }

    state.searchController =
        new AbortController();

    const section =
        $("#searchSection");

    const grid =
        $("#searchGrid");

    const title =
        $("#searchTitle");

    section?.classList.remove(
        "hidden"
    );

    if (title) {
        title.textContent =
            `Results for "${query}"`;
    }

    if (grid) {
        grid.innerHTML =
            createSkeletons(8);
    }

    try {

        const data =
            await apiRequest(
                `${API}/search?q=${encodeURIComponent(query)}`,
                {
                    signal:
                        state.searchController.signal,
                    noCache: true
                }
            );

        renderMovies(
            grid,
            data?.movies || []
        );

        section?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {
            return;
        }

        console.error(
            "Search error:",
            error
        );

        if (grid) {

            grid.innerHTML = `
                <div
                    style="
                        grid-column:1/-1;
                        padding:30px 0;
                        color:#6b7280;
                    "
                >
                    Search failed.
                    Please try again.
                </div>
            `;
        }

        showToast(
            friendlyError(error)
        );
    }
}


/* =========================================================
   MODAL
   ========================================================= */

function openMovieModal() {

    const modal =
        $("#movieModal");

    if (!modal) {
        return;
    }

    modal.classList.remove(
        "hidden"
    );

    modal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.style.overflow =
        "hidden";
}


function closeMovieModal() {

    const modal =
        $("#movieModal");

    if (!modal) {
        return;
    }

    modal.classList.add(
        "hidden"
    );

    modal.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.style.overflow =
        "";
}


/* =========================================================
   REMOVE OLD RECOMMEND BUTTON
   ========================================================= */

function removeRecommendationButton() {

    const button =
        $("#recommendBtn");

    if (button) {
        button.remove();
    }
}


/* =========================================================
   MOVE RECOMMENDATIONS INTO MODAL
   ========================================================= */

function moveRecommendationsIntoModal() {

    const modalPanel =
        document.querySelector(
            "#movieModal .modal-panel"
        );

    const recommendationSection =
        $("#recommendations");

    if (
        !modalPanel ||
        !recommendationSection
    ) {
        return false;
    }

    if (
        recommendationSection.parentElement !==
        modalPanel
    ) {

        modalPanel.appendChild(
            recommendationSection
        );
    }

    recommendationSection.classList.remove(
        "hidden"
    );

    recommendationSection.setAttribute(
        "data-inside-modal",
        "true"
    );

    removeRecommendationButton();

    return true;
}


/* =========================================================
   RESET MODAL
   ========================================================= */

function resetModal() {

    setText(
        "#modalTitle",
        "Loading...",
        "Loading..."
    );

    setText(
        "#modalRating",
        "0.0",
        "0.0"
    );

    setText(
        "#modalYear",
        "N/A",
        "N/A"
    );

    setText(
        "#modalRuntime",
        "",
        ""
    );

    setText(
        "#modalTagline",
        "",
        ""
    );

    setText(
        "#modalOverview",
        "Loading movie information...",
        "Loading movie information..."
    );

    setText(
        "#modalDirector",
        "",
        "Not available"
    );

    setText(
        "#modalCast",
        "",
        "Not available"
    );

    const poster =
        $("#modalPoster");

    if (poster) {
        poster.removeAttribute("src");
        poster.alt = "";
    }

    const cover =
        $("#modalCoverBg");

    if (cover) {
        cover.style.backgroundImage =
            "none";
    }

    const genres =
        $("#modalGenres");

    if (genres) {
        genres.innerHTML = "";
    }

    const trailer =
        $("#trailerBtn");

    if (trailer) {
        trailer.hidden = true;
    }
}


/* =========================================================
   OPEN MOVIE
   ========================================================= */

async function openMovie(movieId) {

    const id =
        Number(movieId);

    if (
        !Number.isInteger(id) ||
        id <= 0
    ) {
        return;
    }

    if (state.movieController) {
        state.movieController.abort();
    }

    if (
        state.recommendationController
    ) {
        state.recommendationController.abort();
    }

    state.movieController =
        new AbortController();

    state.recommendationRequestId++;

    moveRecommendationsIntoModal();

    resetModal();

    openMovieModal();

    const panel =
        document.querySelector(
            "#movieModal .modal-panel"
        );

    if (panel) {
        panel.scrollTop = 0;
    }

    try {

        const movie =
            await apiRequest(
                `${API}/movie/${id}`,
                {
                    signal:
                        state.movieController.signal
                }
            );

        if (!movie) {
            throw new Error(
                "Movie details were not found."
            );
        }

        state.currentMovie =
            normalizeMovie(movie);

        const current =
            state.currentMovie;


        /* DETAILS */

        setText(
            "#modalTitle",
            current.title,
            "Unknown Movie"
        );

        const rating =
            Number(
                current.rating || 0
            );

        setText(
            "#modalRating",
            Number.isFinite(rating)
                ? rating.toFixed(1)
                : "0.0",
            "0.0"
        );

        setText(
            "#modalYear",
            current.year,
            "N/A"
        );

        setText(
            "#modalRuntime",
            current.runtime
                ? `${current.runtime} min`
                : "",
            ""
        );

        setText(
            "#modalTagline",
            current.tagline,
            ""
        );

        setText(
            "#modalOverview",
            current.overview,
            "No overview available."
        );


        /* POSTER */

        const poster =
            $("#modalPoster");

        if (poster) {

            poster.src =
                current.poster_large ||
                current.poster ||
                "";

            poster.alt =
                `${current.title} poster`;
        }


        /* BACKDROP */

        const cover =
            $("#modalCoverBg");

        if (cover) {

            if (current.backdrop) {

                cover.style.backgroundImage =
                    `url("${current.backdrop}")`;

            } else {

                cover.style.backgroundImage =
                    "none";
            }
        }


        /* GENRES */

        const genres =
            $("#modalGenres");

        if (genres) {

            genres.innerHTML =
                current.genres
                    .filter(Boolean)
                    .map(
                        genre => `
                            <span class="chip">
                                ${escapeHtml(genre)}
                            </span>
                        `
                    )
                    .join("");
        }


        /* DIRECTOR */

        setText(
            "#modalDirector",
            current.director,
            "Not available"
        );


        /* CAST */

        const cast =
            current.cast
                .slice(0, 6)
                .map(person => {

                    if (
                        typeof person ===
                        "string"
                    ) {
                        return person;
                    }

                    return person?.name;
                })
                .filter(Boolean)
                .join(", ");

        setText(
            "#modalCast",
            cast,
            "Not available"
        );


        /* TRAILER */

        const trailer =
            $("#trailerBtn");

        if (trailer) {
            trailer.hidden =
                !current.trailer_key;
        }


        /* AUTOMATIC RECOMMENDATIONS */

        await loadRecommendations(
            current
        );

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {
            return;
        }

        console.error(
            "Movie details error:",
            error
        );

        closeMovieModal();

        showToast(
            friendlyError(error)
        );
    }
}


/* =========================================================
   RECOMMENDATIONS
   ========================================================= */

function prepareRecommendationArea(movie) {

    moveRecommendationsIntoModal();

    const section =
        $("#recommendations");

    const grid =
        $("#recommendationGrid");

    if (
        !section ||
        !grid
    ) {
        return null;
    }

    section.classList.remove(
        "hidden"
    );

    setText(
        "#basedOn",
        movie.title,
        "this movie"
    );

    grid.innerHTML =
        createSkeletons(11);

    return {
        section,
        grid
    };
}


async function loadRecommendations(movie) {

    if (
        !movie ||
        !movie.title
    ) {
        return;
    }

    const area =
        prepareRecommendationArea(
            movie
        );

    if (!area) {
        return;
    }

    const {
        section,
        grid
    } = area;

    if (
        state.recommendationController
    ) {
        state.recommendationController.abort();
    }

    state.recommendationController =
        new AbortController();

    const requestId =
        ++state.recommendationRequestId;

    try {

        const data =
            await apiRequest(
                `${API}/recommendations?title=${encodeURIComponent(
                    movie.title
                )}`,
                {
                    signal:
                        state.recommendationController.signal,
                    noCache: true
                }
            );

        if (
            requestId !==
            state.recommendationRequestId
        ) {
            return;
        }

        const selectedId =
            Number(
                movie.tmdb_id ||
                movie.id ||
                0
            );

        const selectedTitle =
            String(
                movie.title || ""
            )
                .trim()
                .toLowerCase();

        const recommendations =
            (
                Array.isArray(
                    data?.movies
                )
                    ? data.movies
                    : []
            )
                .map(normalizeMovie)
                .filter(Boolean)
                .filter(item => {

                    const sameId =
                        selectedId > 0 &&
                        Number(
                            item.tmdb_id
                        ) === selectedId;

                    const sameTitle =
                        String(
                            item.title
                        )
                            .trim()
                            .toLowerCase() ===
                        selectedTitle;

                    return (
                        !sameId &&
                        !sameTitle
                    );
                })
                .slice(0, 11);

        renderMovies(
            grid,
            recommendations
        );

        section.classList.remove(
            "hidden"
        );

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {
            return;
        }

        console.error(
            "Recommendation error:",
            error
        );

        grid.innerHTML = `
            <div
                style="
                    grid-column:1/-1;
                    padding:25px 0;
                    color:#6b7280;
                "
            >
                Recommendations could not
                be loaded.
            </div>
        `;

        showToast(
            friendlyError(error)
        );
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function scrollToSection(id) {

    const element =
        document.getElementById(id);

    if (!element) {
        return;
    }

    element.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


function setupNavigation() {

    $("#homeBtn")
        ?.addEventListener(
            "click",
            () =>
                scrollToSection(
                    "home"
                )
        );

    $("#exploreBtn")
        ?.addEventListener(
            "click",
            () =>
                scrollToSection(
                    "popular"
                )
        );

    document
        .querySelectorAll(
            "[data-scroll]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const target =
                        button.dataset.scroll;

                    if (target) {
                        scrollToSection(
                            target
                        );
                    }
                }
            );
        });
}


/* =========================================================
   SEARCH
   ========================================================= */

function setupSearch() {

    const input =
        $("#searchInput");

    const searchButton =
        $("#searchBtn");

    const clearButton =
        $("#clearSearch");

    searchButton?.addEventListener(
        "click",
        searchMovies
    );

    input?.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                searchMovies();
            }
        }
    );

    input?.addEventListener(
        "input",
        () => {

            if (!clearButton) {
                return;
            }

            clearButton.style.display =
                input.value.trim()
                    ? "block"
                    : "none";
        }
    );

    clearButton?.addEventListener(
        "click",
        () => {

            if (input) {
                input.value = "";
                input.focus();
            }

            clearButton.style.display =
                "none";

            $("#searchSection")
                ?.classList.add(
                    "hidden"
                );
        }
    );
}


/* =========================================================
   MOVIE CARD EVENTS
   ========================================================= */

function setupMovieCards() {

    document.addEventListener(
        "click",
        event => {

            const card =
                event.target.closest(
                    ".movie-card"
                );

            if (!card) {
                return;
            }

            event.preventDefault();

            const movieId =
                card.dataset.movieId;

            if (movieId) {
                openMovie(movieId);
            }
        }
    );


    document.addEventListener(
        "keydown",
        event => {

            const card =
                event.target.closest(
                    ".movie-card"
                );

            if (!card) {
                return;
            }

            if (
                event.key === "Enter" ||
                event.key === " "
            ) {

                event.preventDefault();

                const movieId =
                    card.dataset.movieId;

                if (movieId) {
                    openMovie(movieId);
                }
            }
        }
    );
}


/* =========================================================
   MODAL
   ========================================================= */

function setupModal() {

    $("#modalClose")
        ?.addEventListener(
            "click",
            closeMovieModal
        );

    $("#modalBackdrop")
        ?.addEventListener(
            "click",
            closeMovieModal
        );

    removeRecommendationButton();


    $("#trailerBtn")
        ?.addEventListener(
            "click",
            () => {

                const key =
                    state.currentMovie
                        ?.trailer_key;

                if (!key) {

                    showToast(
                        "Trailer is not available."
                    );

                    return;
                }

                window.open(
                    `https://www.youtube.com/watch?v=${encodeURIComponent(
                        key
                    )}`,
                    "_blank",
                    "noopener,noreferrer"
                );
            }
        );


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Escape"
            ) {
                closeMovieModal();
            }
        }
    );
}


/* =========================================================
   KEEP OLD RECOMMEND BUTTON REMOVED
   ========================================================= */

function watchForOldRecommendButton() {

    const modal =
        $("#movieModal");

    if (!modal) {
        return;
    }

    const observer =
        new MutationObserver(() => {

            removeRecommendationButton();

        });

    observer.observe(
        modal,
        {
            childList: true,
            subtree: true
        }
    );
}


/* =========================================================
   INITIALIZE
   ========================================================= */

async function initializeApp() {

    /*
       Create only the two new sections.
       Existing CSS and HTML design remain untouched.
    */

    createExtraMovieSections();

    moveRecommendationsIntoModal();

    removeRecommendationButton();

    setupNavigation();

    setupSearch();

    setupMovieCards();

    setupModal();

    watchForOldRecommendButton();

    showLoading();

    try {

        /*
           Load all sections in parallel
           for faster page loading.
        */

        await Promise.allSettled([
            loadHomeMovies(),
            loadTopRatedMovies(),
            loadAnimationMovies(),
            loadTrendingMovies()
        ]);

    } finally {

        hideLoading();
    }
}


/* =========================================================
   START
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeApp,
        {
            once: true
        }
    );

} else {

    initializeApp();
}