import { Runtime } from "foldkit";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { Flags, Message, Model, flags, init, subscriptions, update, view } from "./main";

const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById("root"),
  devTools: { Message },
});

Runtime.run(application);

window.addEventListener("beforeunload", (event) => {
  if (Reflect.get(window, "__AGENTLINT_REVIEW_DIRTY__") !== true) return;
  event.preventDefault();
  event.returnValue = "";
});
