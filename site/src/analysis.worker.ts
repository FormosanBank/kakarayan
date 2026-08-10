import {analyzeRecords, type AnalysisOptions} from "./analysis";
import type {SearchRecord} from "./types";

interface Request {
  records: SearchRecord[];
  options: AnalysisOptions;
}

self.onmessage = (event: MessageEvent<Request>) => {
  self.postMessage(analyzeRecords(event.data.records, event.data.options));
};
