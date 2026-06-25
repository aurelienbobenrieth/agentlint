const message = "Decode JSON.parse results with an Effect Schema decoder.";

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

function isSchemaDecoderCall(node, jsonParseNode) {
  if (node?.type !== "CallExpression") return false;
  if (!node.arguments?.includes(jsonParseNode)) return false;

  const callee = node.callee;
  return callee?.type === "Identifier" && callee.name.endsWith("Decoder");
}

export default {
  meta: {
    name: "agentlint",
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
            if (isSchemaDecoderCall(node.parent, node)) return;

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
