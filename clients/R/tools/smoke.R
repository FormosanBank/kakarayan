args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 1L)

library(kakarayan)

client <- kakarayan_client(args[[1L]], mode = "live")
meta <- kakarayan_meta(client)
stopifnot(startsWith(meta$release_id, "fb-20240102-"))
languages <- kakarayan_languages(client)
stopifnot(any(vapply(languages, function(item) item$id == "lang_amis", logical(1))))
dictionary <- kakarayan_dictionary(
  client,
  "lima",
  "lang_amis",
  match = "exact"
)
stopifnot(length(dictionary$items) == 1L)
