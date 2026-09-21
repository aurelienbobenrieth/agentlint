const message =
  "Parse JSON through an Effect Schema decoder, such as Schema.fromJsonString(...), before using the value.";

function isJsonParse(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "JSON" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "parse"
  );
}

function isEffectSchemaDecoderCall(node, jsonParseNode) {
  if (node?.type !== "CallExpression") return false;
  if (!node.arguments?.includes(jsonParseNode)) return false;

  const callee = node.callee;
  return callee?.type === "Identifier" && callee.name.endsWith("Decoder");
}

function isTaggedErrorCall(node) {
  // Schema.TaggedError<E>()("tag", { ...fields })
  const outer = node.callee;
  if (outer?.type !== "CallExpression") return false;
  const inner = outer.callee;
  return (
    inner?.type === "MemberExpression" &&
    inner.property?.type === "Identifier" &&
    (inner.property.name === "TaggedError" || inner.property.name === "TaggedErrorClass")
  );
}

function hasStringlyMessage(fields) {
  if (fields?.type !== "ObjectExpression") return false;
  return fields.properties.some(
    (property) =>
      property.type === "Property" &&
      property.key?.type === "Identifier" &&
      property.key.name === "message" &&
      property.value?.type === "MemberExpression" &&
      property.value.property?.type === "Identifier" &&
      property.value.property.name === "String",
  );
}

export default {
  meta: {
    name: "agentlint",
  },
  rules: {
    "no-stringly-error-message": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Tagged errors carry structured fields and derive `message`; a `message: Schema.String` field hides the failure shape.",
        },
        messages: {
          stringly: "Replace the stringly `message` field with structured fields and a derived `message` getter.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isTaggedErrorCall(node)) return;
            if (!hasStringlyMessage(node.arguments?.[1])) return;
            context.report({ node, messageId: "stringly" });
          },
        };
      },
    },
    "no-direct-process-access": {
      meta: {
        type: "problem",
        docs: {
          description: "Only src/config/env.ts touches `process.*`; everything else depends on the Env service.",
        },
        messages: {
          direct: "Read this value through the Env service instead of `process`.",
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            if (node.object?.type !== "Identifier" || node.object.name !== "process") return;
            context.report({ node, messageId: "direct" });
          },
        };
      },
    },
    "no-raw-json-parse": {
      meta: {
        type: "problem",
        docs: {
          description: "Require Effect Schema decoding for JSON.parse results.",
        },
        messages: {
          decodeJson: message,
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isJsonParse(node)) return;
            if (isEffectSchemaDecoderCall(node.parent, node)) return;

            context.report({
              node,
              messageId: "decodeJson",
            });
          },
        };
      },
    },
  },
};
