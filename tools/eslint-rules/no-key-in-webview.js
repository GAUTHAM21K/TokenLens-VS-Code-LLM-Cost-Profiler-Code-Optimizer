/**
 * ESLint rule: forbid passing raw API keys/secrets to postMessage, send or loggers.
 *
 * Exports: default
 * Feature: tooling
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow passing raw API keys or secrets to postMessage, send, or loggers",
      category: "Security",
      recommended: true,
    },
    schema: [],
    messages: {
      noSecretInTarget:
        "Potential secret '{{ name }}' passed to {{ target }}. API keys and secrets must never be passed to the webview or logger.",
    },
  },
  create(context) {
    const SECRET_REGEX = /^(api_?key|key|secret|password|access_?token|raw_?key)$/i;

    function isSecretName(name) {
      if (!name) return false;
      // Allow masked keys or metadata identifiers like maskedKey, keySlot, keyCount, keyFormatHint
      if (/^masked/i.test(name) || /key(slot|count|id|name|type|hint|format)/i.test(name)) {
        return false;
      }
      return SECRET_REGEX.test(name) || /^(raw|api)?key$/i.test(name);
    }

    function getMemberTail(node) {
      if (node.type === "MemberExpression" && node.property.type === "Identifier") {
        return node.property.name;
      }
      return null;
    }

    function checkNode(node, targetName) {
      if (!node) return;

      if (node.type === "Identifier" && isSecretName(node.name)) {
        context.report({
          node,
          messageId: "noSecretInTarget",
          data: { name: node.name, target: targetName },
        });
        return;
      }

      if (node.type === "MemberExpression") {
        const tail = getMemberTail(node);
        if (tail && isSecretName(tail)) {
          context.report({
            node,
            messageId: "noSecretInTarget",
            data: { name: tail, target: targetName },
          });
          return;
        }
      }

      if (node.type === "TemplateLiteral") {
        for (const expr of node.expressions) {
          checkNode(expr, targetName);
        }
        return;
      }

      if (node.type === "BinaryExpression") {
        checkNode(node.left, targetName);
        checkNode(node.right, targetName);
        return;
      }

      if (node.type === "Property") {
        const keyName =
          node.key && (node.key.name || (typeof node.key.value === "string" ? node.key.value : ""));
        if (isSecretName(keyName)) {
          context.report({
            node,
            messageId: "noSecretInTarget",
            data: { name: keyName, target: targetName },
          });
          return;
        }
        if (node.value) {
          checkNode(node.value, targetName);
        }
        return;
      }

      if (node.type === "ObjectExpression") {
        for (const prop of node.properties) {
          if (prop.type === "Property") {
            checkNode(prop, targetName);
          } else if (prop.type === "SpreadElement") {
            checkNode(prop.argument, targetName);
          }
        }
        return;
      }

      if (node.type === "ArrayExpression") {
        for (const el of node.elements) {
          checkNode(el, targetName);
        }
        return;
      }
    }

    return {
      CallExpression(node) {
        let isTarget = false;
        let targetName = "";

        if (node.callee.type === "Identifier") {
          if (node.callee.name === "postMessage" || node.callee.name === "send") {
            isTarget = true;
            targetName = node.callee.name;
          }
        } else if (node.callee.type === "MemberExpression") {
          const propName =
            node.callee.property.type === "Identifier" ? node.callee.property.name : "";
          const objName =
            node.callee.object.type === "Identifier" ? node.callee.object.name : "";

          if (propName === "send") {
            isTarget = true;
            targetName = "send";
          } else if (propName === "postMessage") {
            if (objName === "vscodeBridge") {
              // Only allowed if message type is strictly "auth/saveKey" (Finding 8)
              const firstArg = node.arguments[0];
              const isSaveKey =
                firstArg &&
                firstArg.type === "ObjectExpression" &&
                firstArg.properties.some(
                  (p) =>
                    p.type === "Property" &&
                    p.key &&
                    (p.key.name === "type" || p.key.value === "type") &&
                    p.value &&
                    p.value.type === "Literal" &&
                    p.value.value === "auth/saveKey"
                );
              if (!isSaveKey) {
                isTarget = true;
                targetName = "vscodeBridge.postMessage";
              }
            } else {
              isTarget = true;
              targetName = "postMessage";
            }
          } else if (
            /^(logger|console)$/i.test(objName) ||
            (node.callee.object.type === "MemberExpression" &&
              node.callee.object.property &&
              node.callee.object.property.name === "logger")
          ) {
            isTarget = true;
            targetName = "logger";
          } else if (propName === "appendLine") {
            isTarget = true;
            targetName = "OutputChannel.appendLine";
          } else if (/^show(Information|Error|Warning)Message$/.test(propName)) {
            isTarget = true;
            targetName = `vscode.window.${propName}`;
          }
        }

        if (isTarget && node.arguments.length > 0) {
          for (const arg of node.arguments) {
            checkNode(arg, targetName);
          }
        }
      },
    };
  },
};
