#' Create a Kakarayan API client
#'
#' @param base_url Static site or live API base URL.
#' @param mode Either `"static"` or `"live"`.
#' @param release_id Optional immutable release identifier.
#' @param timeout Request timeout in seconds.
#' @export
kakarayan_client <- function(base_url, mode = c("static", "live"),
                             release_id = NULL, timeout = 15) {
  mode <- match.arg(mode)
  stopifnot(is.character(base_url), length(base_url) == 1L)
  state <- new.env(parent = emptyenv())
  state$release_checked <- FALSE
  structure(
    list(
      base_url = sub("/+$", "", base_url),
      mode = mode,
      release_id = release_id,
      timeout = timeout,
      state = state
    ),
    class = "kakarayan_client"
  )
}

.kak_error <- function(code, message, status = 0L, field = NULL) {
  condition <- structure(
    list(
      message = message,
      call = NULL,
      code = code,
      status = status,
      field = field
    ),
    class = c("kakarayan_error", "error", "condition")
  )
  stop(condition)
}

.kak_request <- function(client, path) {
  handle <- curl::new_handle(
    timeout = client$timeout,
    useragent = paste0(
      "kakarayan-r/0.1 ",
      "(+https://formosanbank.github.io/kakarayan/)"
    )
  )
  curl::handle_setheaders(
    handle,
    Accept = "application/json",
    "X-Kakarayan-Client" = "r/0.1"
  )
  response <- tryCatch(
    curl::curl_fetch_memory(paste0(client$base_url, path), handle = handle),
    error = function(error) {
      .kak_error("network_error", conditionMessage(error))
    }
  )
  body <- tryCatch(
    jsonlite::fromJSON(rawToChar(response$content), simplifyVector = FALSE),
    error = function(error) {
      .kak_error("invalid_json", "Kakarayan returned invalid JSON")
    }
  )
  if (response$status_code >= 400L) {
    detail <- body$error
    .kak_error(
      detail$code %||% "http_error",
      detail$message %||% paste("Kakarayan returned HTTP", response$status_code),
      response$status_code,
      detail$field
    )
  }
  headers <- curl::parse_headers_list(response$headers)
  response_release <- headers[["x-kakarayan-release"]]
  if (is.null(response_release) && is.list(body)) {
    response_release <- body$release_id
  }
  if (!is.null(client$release_id) &&
      !is.null(response_release) &&
      !identical(client$release_id, response_release)) {
    .kak_error(
      "release_mismatch",
      paste("Expected release", client$release_id, "received", response_release),
      409L
    )
  }
  body
}

`%||%` <- function(left, right) {
  if (is.null(left)) right else left
}

.kak_ensure_release <- function(client) {
  if (!is.null(client$release_id) && !client$state$release_checked) {
    kakarayan_meta(client)
    client$state$release_checked <- TRUE
  }
}

.kak_static_data <- function(client, path) {
  envelope <- .kak_request(client, path)
  if (!is.list(envelope) ||
      !identical(envelope$api_version, "v1") ||
      is.null(envelope$data)) {
    .kak_error(
      "invalid_envelope",
      "The static API response envelope is invalid",
      409L
    )
  }
  envelope$data
}

.kak_query <- function(values) {
  values <- values[!vapply(values, is.null, logical(1))]
  if (!length(values)) {
    return("")
  }
  encoded <- vapply(
    values,
    function(value) utils::URLencode(as.character(value), reserved = TRUE),
    character(1)
  )
  paste0("?", paste(names(encoded), encoded, sep = "=", collapse = "&"))
}

.kak_live <- function(client, endpoint, values) {
  if (!identical(client$mode, "live")) {
    .kak_error(
      "live_api_required",
      paste(endpoint, "requires a live API base URL"),
      400L
    )
  }
  paste0("/v1/", endpoint, .kak_query(values))
}

#' Read release metadata
#' @param client Kakarayan client.
#' @export
kakarayan_meta <- function(client) {
  path <- if (client$mode == "static") "/api/v1/meta.json" else "/v1/meta"
  .kak_request(client, path)
}

#' Read the language catalogue
#' @inheritParams kakarayan_meta
#' @export
kakarayan_languages <- function(client) {
  .kak_ensure_release(client)
  path <- if (client$mode == "static") {
    "/api/v1/languages.json"
  } else {
    "/v1/languages"
  }
  if (client$mode == "static") {
    .kak_static_data(client, path)
  } else {
    .kak_request(client, path)
  }
}

#' Read the corpus catalogue
#' @inheritParams kakarayan_meta
#' @export
kakarayan_corpora <- function(client) {
  .kak_ensure_release(client)
  path <- if (client$mode == "static") "/api/v1/corpora.json" else "/v1/corpora"
  if (client$mode == "static") {
    .kak_static_data(client, path)
  } else {
    .kak_request(client, path)
  }
}

#' Read the static search manifest
#' @inheritParams kakarayan_meta
#' @export
kakarayan_search_manifest <- function(client) {
  if (client$mode != "static") {
    .kak_error(
      "static_api_required",
      "Search shards are available from the static API",
      400L
    )
  }
  .kak_ensure_release(client)
  .kak_static_data(client, "/api/v1/search/manifest.json")
}

#' Read one allowlisted static search shard
#' @inheritParams kakarayan_meta
#' @param path Path from the search manifest.
#' @param sha256 Compressed SHA-256 from the search manifest.
#' @param uncompressed_sha256 Content SHA-256 from the search manifest.
#' @export
kakarayan_search_shard <- function(client, path, sha256, uncompressed_sha256) {
  valid <- grepl("^search/shards/[A-Za-z0-9_./-]+[.]json[.]gz$", path) &&
    !any(strsplit(path, "/", fixed = TRUE)[[1L]] == "..")
  if (client$mode != "static" || !valid) {
    .kak_error("invalid_shard", "The search shard path is invalid", 400L)
  }
  .kak_ensure_release(client)
  handle <- curl::new_handle(
    timeout = client$timeout,
    useragent = "kakarayan-r/0.1"
  )
  response <- tryCatch(
    curl::curl_fetch_memory(
      paste0(client$base_url, "/data/", path),
      handle = handle
    ),
    error = function(error) {
      .kak_error("network_error", conditionMessage(error))
    }
  )
  if (response$status_code >= 400L) {
    .kak_error(
      "search_data_failed",
      paste("Search data returned HTTP", response$status_code),
      response$status_code
    )
  }
  received <- response$content
  is_gzip <- length(received) >= 2L &&
    identical(as.integer(received[1:2]), c(31L, 139L))
  if (is_gzip) {
    actual <- digest::digest(received, algo = "sha256", serialize = FALSE)
    if (!identical(tolower(sha256), actual)) {
      .kak_error(
        "checksum_mismatch",
        "Compressed search checksum verification failed",
        409L
      )
    }
    content <- tryCatch(
      memDecompress(received, type = "gzip"),
      error = function(error) {
        .kak_error("invalid_compression", "Search data is not valid gzip", 409L)
      }
    )
  } else {
    content <- received
  }
  actual_content <- digest::digest(content, algo = "sha256", serialize = FALSE)
  if (!identical(tolower(uncompressed_sha256), actual_content)) {
    .kak_error(
      "checksum_mismatch",
      "Search content checksum verification failed",
      409L
    )
  }
  tryCatch(
    jsonlite::fromJSON(rawToChar(content), simplifyVector = FALSE),
    error = function(error) {
      .kak_error("invalid_json", "Search data contains invalid JSON", 409L)
    }
  )
}

#' Query dictionary candidates
#' @inheritParams kakarayan_meta
#' @param q Query text.
#' @param language_id Stable language identifier.
#' @param ... Additional documented live API parameters.
#' @export
kakarayan_dictionary <- function(client, q, language_id, ...) {
  values <- c(list(q = q, language_id = language_id), list(...))
  .kak_request(client, .kak_live(client, "dictionary", values))
}

#' Query concordance lines
#' @inheritParams kakarayan_dictionary
#' @export
kakarayan_concordance <- function(client, q, language_id, ...) {
  values <- c(list(q = q, language_id = language_id), list(...))
  .kak_request(client, .kak_live(client, "concordance", values))
}

#' Query token frequencies
#' @inheritParams kakarayan_meta
#' @param language_id Stable language identifier.
#' @param ... Additional documented live API parameters.
#' @export
kakarayan_frequencies <- function(client, language_id, ...) {
  values <- c(list(language_id = language_id), list(...))
  .kak_request(client, .kak_live(client, "frequencies", values))
}

#' Collect all pages from one live query
#' @inheritParams kakarayan_frequencies
#' @param method One of `"frequencies"`, `"dictionary"`, or `"concordance"`.
#' @param q Query text for dictionary or concordance.
#' @export
kakarayan_pages <- function(client, method, language_id, q = NULL, ...) {
  method <- match.arg(method, c("frequencies", "dictionary", "concordance"))
  items <- list()
  cursor <- NULL
  repeat {
    arguments <- c(
      list(client = client),
      if (!is.null(q)) list(q = q) else list(),
      list(language_id = language_id, cursor = cursor),
      list(...)
    )
    page <- do.call(get(paste0("kakarayan_", method), mode = "function"), arguments)
    items <- c(items, page$items)
    cursor <- page$next_cursor
    if (is.null(cursor) || !nzchar(cursor)) {
      break
    }
  }
  items
}

#' Download and verify one artifact
#' @inheritParams kakarayan_meta
#' @param url Artifact URL from the release manifest.
#' @param destination Local destination.
#' @param sha256 Expected lowercase SHA-256.
#' @export
kakarayan_download <- function(client, url, destination, sha256) {
  origin <- function(value) {
    sub("^(https?://[^/]+).*$", "\\1", value)
  }
  if (!identical(origin(client$base_url), origin(url))) {
    .kak_error(
      "invalid_download_url",
      "Downloads must use the configured Kakarayan origin",
      400L
    )
  }
  destination <- normalizePath(destination, mustWork = FALSE)
  directory <- dirname(destination)
  dir.create(directory, recursive = TRUE, showWarnings = FALSE)
  temporary <- tempfile(pattern = ".kakarayan-", tmpdir = directory)
  on.exit(unlink(temporary), add = TRUE)
  handle <- curl::new_handle(
    timeout = client$timeout,
    useragent = "kakarayan-r/0.1"
  )
  curl::curl_download(url, temporary, handle = handle, quiet = TRUE)
  actual <- digest::digest(file = temporary, algo = "sha256", serialize = FALSE)
  if (!identical(tolower(sha256), actual)) {
    .kak_error(
      "checksum_mismatch",
      "Download checksum verification failed",
      409L
    )
  }
  if (!file.rename(temporary, destination)) {
    .kak_error("download_write_failed", "Could not place the verified download")
  }
  invisible(destination)
}
