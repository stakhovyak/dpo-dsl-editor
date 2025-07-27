import * as ace from 'ace-builds'
import parser from './bundle/parser.js'

const tutorial = `^ This is a comment line

^ The only data type in the dsl is an array of arrays.
foo = (x,y)(a,b,c);
bar = (A)(B,C);
baz_quux = (p,q,r)(s)(t,u)(v,w,x,y,z);

^ Declare rules with @predicate.
@grow = (X) -> (Y,Z) -> (W);
@chain = foo -> bar -> (D,E);

^ Declare states with $predicate and use \`<~\` to apply rule to state or array
$st_inline = (P)(Q,R) <~ (U)->(V)->(W);

$st_named = (M,N) <~ @grow 3;

$st_var = foo <~ @chain;

$st_mixed = bar <~ (L)->(M,N)->(O) 5;

^ Or combine them all together
$final_test = baz_quux <~ @grow 1;
`;

const editor = ace.edit("editor")

editor.setOptions({
    fontSize: "14pt",
    showPrintMargin: false,
    wrap: true,
    value: tutorial,
});

editor.session.on('change', () => {
    // console.log(editor.getValue())
});

const runButton = document.getElementById("run-button");

type ASTNode = ArrayNode | RuleNode | StateNode;

interface ArrayNode {
    type: "array";
    name: string;
    value: string[][];
}

interface RuleNode {
    type: "rule";
    name: string;
    sequence: SeqItem[];
}

interface StateNode {
    type: "state";
    name: string;
    source: string | string[][];
    rule: SeqItem[];
    count: number | null;
}

type SeqItem =
    | { type: "inline", value: string[][] }     // ArrayGroup inline
    | { type: "varRef", name: string }         // Identifier reference
    | { type: "ruleRef", name: string };        // RuleName reference

function validateAST(ast: ASTNode[]) {
    const variables = new Set<string>();
    const rules = new Set<string>();
    const errors: string[] = [];

    // Собираем имена
    for (const node of ast) {
        if (node.type === "array") variables.add(node.name);
        if (node.type === "rule") rules.add(node.name);
    }

    // Проверяем каждую Rule и State на ссылки
    for (const node of ast) {
        if (node.type === "rule" || node.type === "state") {
            const seq = node.type === "rule" ? node.sequence : node.rule;

            for (const item of seq) {
                if (item.type === "varRef" && !variables.has(item.name)) {
                    errors.push(`Unknown variable '${item.name}' in ${node.type} '${node.name}'`);
                }
                if (item.type === "ruleRef" && !rules.has(item.name)) {
                    errors.push(`Unknown rule '${item.name}' in ${node.type} '${node.name}'`);
                }
            }
        }
        if (node.type === "state" && typeof node.source === "string") {
            if (!variables.has(node.source)) {
                errors.push(`Unknown variable '${node.source}' in state '${node.name}'`);
            }
        }
    }

    return errors;
  }

runButton?.addEventListener("click", (_event: MouseEvent) => {
    const ast = parser.parse(editor.getValue());
    const errors = validateAST(ast);
    if (errors.length) {
        console.error("Semantic errors:\n" + errors.join("\n"));
    } else {
        console.log("AST is valid:", ast);
    }
});