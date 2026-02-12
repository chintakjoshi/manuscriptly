from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html import unescape
from typing import Any
from urllib.parse import parse_qs, urlencode, unquote, urlparse
from urllib.request import Request, urlopen

from app.core.config import Config


class WebSearchServiceError(Exception):
    pass


class WebSearchService:
    def __init__(self) -> None:
        self._endpoint = Config.WEB_SEARCH_API_URL
        self._timeout_seconds = max(Config.WEB_SEARCH_TIMEOUT_SECONDS, 1.0)
        self._default_max_results = max(Config.WEB_SEARCH_MAX_RESULTS, 1)
        self._user_agent = Config.WEB_SEARCH_USER_AGENT

    def search(self, query: str, max_results: int | None = None) -> dict[str, Any]:
        normalized_query = self._normalize_query(query)
        if not normalized_query:
            raise WebSearchServiceError("Search query cannot be empty.")

        result_limit = self._clamp_result_limit(max_results)
        params = urlencode(
            {
                "q": normalized_query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
                "no_redirect": "1",
            }
        )
        request = Request(
            f"{self._endpoint}?{params}",
            headers={
                "User-Agent": self._user_agent,
                "Accept": "application/json",
            },
        )

        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise WebSearchServiceError("Web search request failed. Please try again.") from exc

        results = self._extract_results(payload, result_limit)
        if not results:
            results = self._search_with_duckduckgo_html(normalized_query, result_limit)
        return {
            "status": "success",
            "engine": "duckduckgo",
            "query": normalized_query,
            "result_count": len(results),
            "results": results,
            "searched_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _normalize_query(query: str) -> str:
        return " ".join((query or "").split()).strip()

    def _clamp_result_limit(self, max_results: int | None) -> int:
        if isinstance(max_results, int):
            candidate = max_results
        else:
            candidate = self._default_max_results
        return min(max(candidate, 1), 10)

    @staticmethod
    def _extract_results(payload: dict[str, Any], max_results: int) -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        seen_keys: set[str] = set()

        def push_result(title: str, snippet: str, url: str, source: str) -> None:
            safe_title = " ".join(title.split()).strip()
            safe_snippet = " ".join(snippet.split()).strip()
            safe_url = url.strip()
            if not safe_title or not safe_snippet or not safe_url:
                return
            dedupe_key = f"{safe_title.lower()}::{safe_url.lower()}"
            if dedupe_key in seen_keys:
                return
            seen_keys.add(dedupe_key)
            results.append(
                {
                    "title": safe_title[:240],
                    "snippet": safe_snippet[:600],
                    "url": safe_url[:500],
                    "source": source[:80],
                }
            )

        abstract = str(payload.get("AbstractText") or "").strip()
        abstract_url = str(payload.get("AbstractURL") or "").strip()
        abstract_source = str(payload.get("AbstractSource") or "DuckDuckGo").strip()
        heading = str(payload.get("Heading") or "Overview").strip()
        if abstract and abstract_url:
            push_result(heading or "Overview", abstract, abstract_url, abstract_source or "DuckDuckGo")

        for item in payload.get("Results", []):
            if not isinstance(item, dict):
                continue
            text = str(item.get("Text") or "").strip()
            url = str(item.get("FirstURL") or "").strip()
            if text and url:
                title = text.split(" - ", 1)[0]
                push_result(title or "Result", text, url, "DuckDuckGo")

        def visit_related(items: list[Any]) -> None:
            for item in items:
                if len(results) >= max_results:
                    return
                if not isinstance(item, dict):
                    continue
                nested_topics = item.get("Topics")
                if isinstance(nested_topics, list):
                    visit_related(nested_topics)
                    continue

                text = str(item.get("Text") or "").strip()
                url = str(item.get("FirstURL") or "").strip()
                if text and url:
                    title = text.split(" - ", 1)[0]
                    push_result(title or "Result", text, url, "DuckDuckGo")

        related_topics = payload.get("RelatedTopics")
        if isinstance(related_topics, list):
            visit_related(related_topics)

        return results[:max_results]

    def _search_with_duckduckgo_html(self, query: str, max_results: int) -> list[dict[str, str]]:
        request = Request(
            f"https://duckduckgo.com/html/?{urlencode({'q': query})}",
            headers={
                "User-Agent": self._user_agent,
                "Accept": "text/html",
            },
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                html = response.read().decode("utf-8", errors="ignore")
        except Exception:
            return []

        link_matches = re.findall(
            r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            html,
            flags=re.IGNORECASE | re.DOTALL,
        )
        snippet_matches = re.findall(
            r'class="result__snippet"[^>]*>(.*?)</(?:a|div)>',
            html,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not link_matches:
            return []

        results: list[dict[str, str]] = []
        seen_urls: set[str] = set()
        for index, (raw_href, raw_title) in enumerate(link_matches):
            if len(results) >= max_results:
                break
            url = self._unwrap_duckduckgo_redirect(raw_href)
            if not url:
                continue
            if url.lower() in seen_urls:
                continue
            seen_urls.add(url.lower())

            title = self._strip_html(raw_title)
            snippet_raw = snippet_matches[index] if index < len(snippet_matches) else title
            snippet = self._strip_html(snippet_raw)
            if not title:
                title = "Result"
            if not snippet:
                snippet = title
            source = urlparse(url).netloc or "Web"
            results.append(
                {
                    "title": title[:240],
                    "snippet": snippet[:600],
                    "url": url[:500],
                    "source": source[:80],
                }
            )
        return results

    @staticmethod
    def _unwrap_duckduckgo_redirect(href: str) -> str:
        candidate = href.strip()
        if not candidate:
            return ""
        if candidate.startswith("//"):
            candidate = f"https:{candidate}"
        parsed = urlparse(candidate)
        if parsed.netloc.endswith("duckduckgo.com") and parsed.path == "/l/":
            uddg = parse_qs(parsed.query).get("uddg")
            if uddg and uddg[0]:
                return unquote(uddg[0]).strip()
        return candidate

    @staticmethod
    def _strip_html(value: str) -> str:
        text = re.sub(r"<[^>]+>", " ", value)
        text = unescape(text)
        return " ".join(text.split()).strip()
