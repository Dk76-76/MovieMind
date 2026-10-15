<div align="center">

# 🎬 MovieMind — AI-Powered Movie Discovery Engine

**Discover trending blockbusters, explore detailed filmographies, and get instant AI-driven movie recommendations.**

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111.0-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Scikit-Learn](https://img.shields.io/badge/Scikit--Learn-1.6.1-F7931E?style=for-the-badge&logo=scikit-learn&logoColor=white)](https://scikit-learn.org/)
[![TMDB API](https://img.shields.io/badge/TMDB_API-v3-01B4E4?style=for-the-badge&logo=themoviedatabase&logoColor=white)](https://www.themoviedb.org/)
[![JavaScript](https://img.shields.io/badge/Vanilla_JS-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[Features](#-key-features) • [Architecture](#-system-architecture--highlights) • [Tech Stack](#-tech-stack) • [Installation](#-getting-started) • [API Reference](#-api-endpoints)

</div>

---

## 📖 Overview

**MovieMind** is a modern, full-stack movie discovery web application that combines real-time metadata from **The Movie Database (TMDB)** with a local **Machine Learning Recommendation Engine**. 

Built on an asynchronous **FastAPI** backend and a responsive, zero-dependency **Vanilla JavaScript** frontend, MovieMind delivers a fast, resilient, and intuitive user experience. When a user selects a movie, the system computes cosine similarities across a pre-trained **TF-IDF matrix** using `linear_kernel` and enriches the recommended titles concurrently via the TMDB API.

---

## ✨ Key Features

### 🧠 Machine Learning & Discovery
* **Content-Based AI Recommendations:** Uses a local **TF-IDF (Term Frequency-Inverse Document Frequency)** vectorizer and **Linear Kernel** cosine similarity model to suggest the top 11 most similar movies instantly inside the movie modal.
* **Curated Discovery Feeds:** Browse movies across dedicated categories including **Trending Now**, **Popular**, **Top Rated**, and **Animation**.
* **Real-Time Search Engine:** Instant search functionality with request cancellation (`AbortController`) to prevent race conditions during rapid typing.
* **Rich Movie Modals:** View high-resolution posters, backdrops, ratings, runtime, release year, genres, taglines, plot overviews, director info, top cast, and direct YouTube trailer links.

### ⚡ Backend Performance & Resilience
* **Asynchronous I/O:** Powered by `FastAPI` and `httpx.AsyncClient` with connection pooling for non-blocking external API calls.
* **Two-Tier Caching (TTL + Stale Fallback):** Implements an in-memory TTL cache alongside a `_stale_cache` fallback mechanism, ensuring the site remains functional even during temporary TMDB outages.
* **Rate-Limit & Concurrency Control:** Uses `asyncio.Semaphore(5)` to throttle concurrent outbound requests during recommendation enrichment, preventing API rate-limit bursts.
* **Smart Retry Mechanism:** Automatic exponential backoff and `Retry-After` header handling for HTTP `429`, `500`, `502`, `503`, and `504` responses.

### 🎨 Modern Frontend UX
* **Persistent Dark/Light Mode:** Smooth theme switching backed by `localStorage` and CSS custom properties.
* **Skeleton Shimmer Loaders:** Smooth placeholder animations while fetching data.
* **Client-Side Request Caching:** Deduplicates identical network requests in the browser session for instant modal re-opens.
* **Fully Accessible & Responsive:** Keyboard navigation support (`Enter`, `Space`, `Escape`), ARIA attributes, and adaptive CSS Grid layouts from desktop (6 columns) down to mobile (2 columns).

---

## 🛠 Tech Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Backend Framework** | Python 3.12, FastAPI, Uvicorn (ASGI) |
| **HTTP & Concurrency** | HTTPX (`AsyncClient`), `asyncio` (`Semaphore`, `gather`) |
| **Machine Learning / Data** | Scikit-Learn (`linear_kernel`), Pandas, NumPy, SciPy, Pickle |
| **Frontend** | HTML5 (Jinja2 Templates), Modern CSS3 (Custom Properties, Grid, Flexbox), Vanilla JavaScript (ES6+) |
| **External API** | TMDB REST API v3 |

---

## 📂 Project Structure

```text
MovieMind/
├── static/
│   ├── style.css            # Responsive UI styling, animations & Dark Mode variables
│   └── script.js            # Frontend state management, API client & DOM rendering
├── templates/
│   └── index.html           # Main application shell & modal templates
├── df.pkl                   # Pickled Pandas DataFrame containing movie metadata
├── indices.pkl              # Pickled title-to-index mapping Series/dict
├── tfidf.pkl                # Pickled TF-IDF Vectorizer instance
├── tfidf_matrix.pkl         # Pickled sparse TF-IDF feature matrix
├── main.py                  # FastAPI application, ML inference & TMDB proxy client
├── requirements.txt         # Python dependencies
├── .env                     # Environment variables (API Keys)
└── .gitignore               # Ignored files and directories
```

---

## 🚀 Getting Started

Follow these instructions to set up and run the project locally on your machine.

### 1. Prerequisites
* **Python 3.10+** (Tested on Python `3.12.10`)
* A valid **TMDB API Key** (Get one from [TMDB Developer Settings](https://www.themoviedb.org/settings/api))
* Pre-trained model pickle files (`df.pkl`, `indices.pkl`, `tfidf_matrix.pkl`, `tfidf.pkl`) placed in the root directory alongside `main.py`.

### 2. Clone the Repository
```bash
git clone https://github.com/your-username/MovieMind.git
cd MovieMind
```

### 3. Set Up a Virtual Environment
```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Configure Environment Variables
Create a `.env` file in the root directory (next to `main.py`) and add your TMDB credentials:

```env
TMDB_API_KEY=your_tmdb_v3_api_key_here
# Optional: Alternatively, you can use a v4 Bearer Access Token
# TMDB_ACCESS_TOKEN=your_tmdb_v4_bearer_token_here
```

### 6. Run the Application
Start the development server using Python or Uvicorn directly:

```bash
python main.py
# OR
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser and navigate to:
👉 **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

---

## 🔌 API Endpoints

MovieMind exposes a clean RESTful API consumed by the frontend client. You can also explore interactive Swagger documentation at `http://127.0.0.1:8000/docs`.

| Method | Endpoint | Description | Cache TTL |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Serves the main HTML application interface | — |
| `GET` | `/health` | Returns server health, TMDB config status, and ML model load status | — |
| `GET` | `/api/home` | Fetches popular discovery movies (`?page=1`) | `600s` |
| `GET` | `/api/trending` | Fetches weekly trending movies from TMDB | `600s` |
| `GET` | `/api/popular` | Fetches currently popular movies in the US region | `600s` |
| `GET` | `/api/top-rated` | Fetches highest-rated movies of all time | `900s` |
| `GET` | `/api/animation` | Fetches popular animated movies (Genre ID `16`) | `900s` |
| `GET` | `/api/search` | Searches movies by title (`?q=inception`) | `300s` |
| `GET` | `/api/movie/{tmdb_id}` | Fetches full movie details, cast, director & YouTube trailer in a single TMDB call (`append_to_response=credits,videos`) | `3600s` |
| `GET` | `/api/recommendations` | Computes TF-IDF cosine similarity for `?title=...` and enriches top matches via TMDB | `3600s` |

### Example Health Check Response (`/health`)
```json
{
  "status": "ok",
  "tmdb_configured": true,
  "model_loaded": true,
  "model_error": null,
  "movies_in_model": 4803
}
```

---

## ⚙️ How the Recommendation Pipeline Works

1. **Title Normalization:** When a user clicks on a movie card, the title is normalized (lowercased, stripped of special characters) and matched against `indices.pkl` (supporting both exact and partial fallback matching).
2. **Cosine Similarity Calculation:** Using `sklearn.metrics.pairwise.linear_kernel`, the backend computes the dot product between the selected movie's TF-IDF vector and the entire `tfidf_matrix`:
   $$\text{similarity}(u, v) = u \cdot v^T$$
3. **Candidate Ranking:** The top 11 highest-scoring indices (excluding the input movie itself) are extracted from `df.pkl`.
4. **Concurrent TMDB Enrichment:** The local titles are queried asynchronously via `asyncio.gather` against TMDB's `/search/movie` endpoint (throttled by `tmdb_semaphore`) to fetch fresh posters, ratings, and release years before returning the payload to the UI.

---

## 🛡️ Security Note

Never commit your `.env` file or expose your `TMDB_API_KEY` in public repositories. The `.gitignore` file in this project is pre-configured to exclude `.env`, `.venv/`, and `__pycache__/` automatically.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

<div align="center">
  <b>Built with ❤️ using FastAPI, Scikit-Learn & TMDB</b>
</div>
