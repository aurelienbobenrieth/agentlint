import { Runtime } from "foldkit";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { Message, Model, init, subscriptions, update, view } from "./main";
import { isDirty } from "./shared/dirty-flag";

const application = Runtime.makeApplication({
  Model,
  init,
  update: (...[model, message]) => update({ model, message }),
  view: (...[model, h]) => view({ model, h }),
  subscriptions,
  container: document.getElementById("root"),
  devTools: { Message },
});

Runtime.run(application);

window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
