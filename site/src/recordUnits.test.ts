import {projectRecordUnits} from "./recordUnits";
import type {SearchRecord} from "./types";

const record: SearchRecord = {
  id: "sentence_1",
  text_id: "text_1",
  corpus_id: "corpus_1",
  language_id: "lang_amis",
  dialect: "Xiuguluan",
  source_path: "Corpora/Fixture/XML/a.xml",
  xml_id: "s1",
  standard: "lima waco",
  original: "Lima waco",
  translations: [{text: "five dogs", xml_lang: "eng", kind: "", version: ""}],
  tokens: [
    {surface: "Lima", normalized: "lima", position: 0, word_id: "word_1"},
    {surface: "waco", normalized: "waco", position: 1, word_id: "word_2"},
  ],
  forms: [
    {
      owner_type: "word",
      owner_id: "word_1",
      position: 0,
      text: "lima",
      unclear: 0,
      kind: "standard",
      notes: "",
      normalized: "lima",
    },
    {
      owner_type: "morpheme",
      owner_id: "morpheme_1",
      position: 0,
      text: "lima",
      unclear: 0,
      kind: "standard",
      notes: "",
      normalized: "lima",
    },
  ],
  phonology: [],
  tier_translations: [],
  words: [
    {
      id: "word_1",
      xml_id: "w1",
      position: 0,
      class: "",
      sclass: "",
      morphemes: [
        {
          id: "morpheme_1",
          xml_id: "m1",
          position: 0,
          class: "",
          sclass: "",
        },
      ],
    },
    {
      id: "word_2",
      xml_id: "w2",
      position: 1,
      class: "",
      sclass: "",
      morphemes: [],
    },
  ],
  audio: [
    {
      owner_type: "sentence",
      owner_id: "sentence_1",
      position: 0,
      file: "a.wav",
      url: "",
      source: "",
      start: 0,
      end: 1,
      duration: 1,
      availability_status: "referenced",
    },
  ],
};

describe("browser record-unit projections", () => {
  it("projects stable word, morpheme, token, and audio rows", () => {
    expect(projectRecordUnits([record], "word").map((item) => item.id)).toEqual([
      "word_1",
      "word_2",
    ]);
    expect(projectRecordUnits([record], "morpheme")[0]?.id).toBe("morpheme_1");
    expect(projectRecordUnits([record], "token")[0]?.original).toBe("Lima");
    expect(projectRecordUnits([record], "audio")[0]?.audio[0]?.file).toBe("a.wav");
  });

  it("combines sentences from one text without losing tiers", () => {
    const second = {...record, id: "sentence_2", standard: "toki"};
    const text = projectRecordUnits([record, second], "text")[0];
    expect(text?.id).toBe("text_1");
    expect(text?.standard).toBe("lima waco\ntoki");
    expect(text?.translations).toHaveLength(2);
  });
});
