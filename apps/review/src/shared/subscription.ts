import type { Subscription } from "foldkit";

import type { Message } from "../message";
import type { Model } from "../model";

/** The `entry` builder `Subscription.make` hands to its callback; features declare their entries with it. */
export type SubscriptionEntry = Parameters<Parameters<ReturnType<typeof Subscription.make<Model, Message>>>[0]>[0];
