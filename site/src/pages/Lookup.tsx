import {PageIntro} from "../components/Layout";
import {LookupKindToggle} from "../components/LookupKindToggle";
import {SearchTool, type LookupKind} from "../components/SearchTool";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";

export function Lookup({
  data,
  initialKind = "dictionary",
}: {
  data: AppData;
  initialKind?: LookupKind;
}) {
  const {tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const requestedKind = params.get("type");
  const kind: LookupKind =
    requestedKind === "dictionary" || requestedKind === "sentences"
      ? requestedKind
      : initialKind;

  function selectKind(nextKind: LookupKind) {
    if (nextKind === kind) return;
    const nextParams = Object.fromEntries(params.entries());
    nextParams.type = nextKind;
    delete nextParams.mode;
    delete nextParams.record;
    setParams(nextParams);
  }

  return (
    <div className="page-wrap page-wrap--wide lookup-page">
      <PageIntro
        eyebrow={tx("CORPUS LOOKUP", "語料查詢")}
        title={tx("Dictionary and sentences", "單詞釋義與語境例句")}
        lede={tx(
          "Look up a headword or find it in context across the public corpora.",
          "查詢詞目，或在公開語料庫中查看其使用語境。",
        )}
      />
      <LookupKindToggle kind={kind} onChange={selectKind} />
      <div id="lookup-results">
        <SearchTool key={kind} data={data} kind={kind} />
      </div>
    </div>
  );
}
