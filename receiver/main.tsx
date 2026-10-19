import React from "react";
import { createRoot } from "react-dom/client";
import { DisplayPlayer } from "../src/shared/Renderer";
import { fallbackDocument, type Manifest } from "../src/shared/content";
import "../src/shared/brand.css";
declare global {
  interface Window {
    receiveManifest?: (m: Manifest) => void;
    Screens?: { postMessage: (text: string) => void };
  }
}
const fallback: Manifest = {
  schemaVersion: 1,
  rendererVersion: 1,
  revision: "fallback",
  assignmentId: null,
  contentId: null,
  version: 1,
  orientation: "portrait-cw",
  slides: [
    { id: "fallback", document: fallbackDocument, duration: 60, version: 1 },
  ],
  assets: {},
  epoch: 0,
  live: false,
  commands: [],
};
function Receiver() {
  const [manifest, setManifest] = React.useState(fallback);
  React.useEffect(() => {
    const timer = setInterval(
      () =>
        window.Screens?.postMessage(
          JSON.stringify({ type: "health", revision: manifest.revision }),
        ),
      15000,
    );
    return () => clearInterval(timer);
  }, [manifest.revision]);
  React.useEffect(() => {
    window.receiveManifest = (m) => {
      if (m.schemaVersion !== 1 || m.rendererVersion !== 1) {
        window.Screens?.postMessage(
          JSON.stringify({
            type: "error",
            message: "Renderer update required",
          }),
        );
        return;
      }
      setManifest(m);
    };
    window.Screens?.postMessage(JSON.stringify({ type: "ready" }));
    return () => {
      delete window.receiveManifest;
    };
  }, []);
  return (
    <DisplayPlayer
      manifest={manifest}
      onRender={(slideId) =>
        window.Screens?.postMessage(
          JSON.stringify({
            type: "render",
            revision: manifest.revision,
            slideId,
          }),
        )
      }
      onError={(message) =>
        window.Screens?.postMessage(JSON.stringify({ type: "error", message }))
      }
    />
  );
}
createRoot(document.getElementById("root")!).render(<Receiver />);
