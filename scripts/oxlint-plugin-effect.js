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

export default {
  meta: {
    name: "effect",
  },
  rules: {
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
