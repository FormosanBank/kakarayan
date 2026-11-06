import {StrictMode} from "react";
import {createRoot} from "react-dom/client";

import {App} from "./App";
import {I18nProvider} from "./i18n";
import {prepareRouting} from "./routePaths";
import "./styles.css";

// Another site could frame Kakarayan invisibly and steal clicks on its recorder, consent,
// copy, and deck controls. GitHub Pages cannot send frame-ancestors headers, so a framed
// document renders only a link to open the site directly.
function renderFramedNotice(root: HTMLElement) {
  const notice = document.createElement("main");
  notice.className = "empty-state";
  const title = document.createElement("h2");
  title.textContent = "Open Kakarayan directly";
  const english = document.createElement("p");
  english.textContent = "Kakarayan does not run inside other sites.";
  const chinese = document.createElement("p");
  chinese.lang = "zh-Hant";
  chinese.textContent = "Kakarayan 不在其他網站內執行，請直接開啟。";
  const link = document.createElement("a");
  link.href = location.href;
  link.target = "_top";
  link.textContent = "Open Kakarayan";
  notice.append(title, english, chinese, link);
  root.replaceChildren(notice);
}

const root = document.getElementById("root")!;

if (window.top === window.self) {
  prepareRouting();
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
} else {
  renderFramedNotice(root);
}
