import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../../message";

export const loadingView = (h: HtmlBuilder<Message>): Html =>
  h.main([h.Class("state")], [h.div([h.Class("loader")], []), h.p([], ["Loading review…"])]);

export const loadFailedView = ({ message, h }: { readonly message: string; readonly h: HtmlBuilder<Message> }): Html =>
  h.main([h.Class("state")], [h.h1([], ["Review unavailable"]), h.p([], [message])]);
