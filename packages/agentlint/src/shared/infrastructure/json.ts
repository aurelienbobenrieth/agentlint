import { Schema } from "effect";

const JsonString = Schema.fromJsonString(Schema.Unknown);
const PrettyJsonString = Schema.fromJsonString(Schema.Unknown, { space: 2 });

export const encodeJson = Schema.encodeUnknownSync(JsonString);
export const encodePrettyJson = Schema.encodeUnknownSync(PrettyJsonString);
