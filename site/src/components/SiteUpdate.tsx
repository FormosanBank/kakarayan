import {useEffect, useRef, useState} from "react";
import {useI18n} from "../i18n";
import {useNavigationPermission} from "../routing";

export function SiteUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [otherTabs, setOtherTabs] = useState(false);
  const approved = useRef(false);
  const allowNavigation = useNavigationPermission();
  const {tx} = useI18n();
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let active = true;
    let removeUpdateListener = () => {};
    const changed = () => { if (approved.current) window.location.reload(); };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {updateViaCache: "none"}).then((registration) => {
      const check = () => { if (active) setWaiting(registration.waiting); };
      check();
      const found = () => registration.installing?.addEventListener("statechange", check);
      registration.addEventListener("updatefound", found);
      removeUpdateListener = () => registration.removeEventListener("updatefound", found);
    }).catch(() => { /* Online use remains available if offline installation fails. */ });
    return () => { active = false; removeUpdateListener(); navigator.serviceWorker.removeEventListener("controllerchange", changed); };
  }, []);
  function update() {
    if (!waiting || !allowNavigation()) return;
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => channel.port1.close(), 8_000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === "object" && event.data !== null && "status" in event.data) {
        approved.current = event.data.status === "activating";
        setOtherTabs(event.data.status === "other_tabs");
      }
      channel.port1.close();
      window.clearTimeout(timeout);
    };
    waiting.postMessage({type: "ACTIVATE"}, [channel.port2]);
  }
  if (!waiting) return null;
  return <div className="callout callout--action" role="status">
    <span>{otherTabs ? tx("Close other Kakarayan tabs before updating.", "更新前請關閉其他 Kakarayan 分頁。") : tx("A site update is ready.", "網站更新已就緒。")}</span>
    <button className="text-button" onClick={update}>{tx("Update", "更新")}</button>
  </div>;
}
