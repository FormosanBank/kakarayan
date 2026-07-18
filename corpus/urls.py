from django.urls import path

from corpus.views import dictionary as dict_views

urlpatterns = [
    path("", dict_views.dictionary_index, name="dictionary"),
    path("search/", dict_views.dictionary_search, name="dictionary-search"),
    path("word/<int:token_id>/expand/", dict_views.word_expand, name="word-expand"),
    path("word/<int:token_id>/collapse/", dict_views.word_collapse, name="word-collapse"),
]
