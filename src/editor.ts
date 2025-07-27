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

type Hyperedge = { vertices: string[] };

interface StateJson {
    hypergraph: Hyperedge[];
    rule: Record<string, Hyperedge[]>;
    steps: number | null;
    clean: boolean;
}

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
    | { type: "inline", value: string[] }     // ArrayGroup inline
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

runButton?.addEventListener("click", () => {
    let ast: ASTNode[];
    try {
        ast = parser.parse(editor.getValue()) as ASTNode[];
    } catch (e: any) {
        console.error("Parse error:", e.message);
        return;
    }

    // Build lookup tables
    const arrays = new Map<string, string[][]>();
    const rules = new Map<string, SeqItem[]>();
    const states: StateNode[] = [];

    for (const node of ast) {
        if (node.type === "array") {
            arrays.set(node.name, node.value);
        } else if (node.type === "rule") {
            rules.set(node.name, node.sequence);
        } else {
            states.push(node);
        }
    }

    // Validate
    const errors = validateAST(ast);
    if (errors.length) {
        console.error("Semantic errors:\n" + errors.join("\n"));
        return;
    }

    // Compact unfold + JSON build + render
    const panel = document.getElementById("detected-states")!;
    panel.innerHTML = "<ul>" + states.map(state => {
        // helper
        const unfold = (item: SeqItem): string[][] =>
            item.type === "inline" ? [item.value] :
                item.type === "varRef" ? (arrays.get(item.name) ?? []) :
                    rules.get(item.name)?.flatMap(unfold) ?? [];

        // build hypergraph
        const srcGroups = typeof state.source === "string"
            ? (arrays.get(state.source) ?? [])
            : state.source;
        const hypergraph = srcGroups.map(g => ({ vertices: g }));

        // build rule object
        let ruleObj: Record<string, { vertices: string[] }[]> = {};
        if (state.rule.length === 1 && state.rule[0].type === "ruleRef") {
            const nm = state.rule[0].name;
            ruleObj[nm] = (rules.get(nm) ?? []).flatMap(unfold).map(v => ({ vertices: v }));
        } else {
            ruleObj["rule"] = state.rule.flatMap(unfold).map(v => ({ vertices: v }));
        }

        const json: any = {
            hypergraph,
            rule: ruleObj,
            steps: state.count,
            clean: true
        };

        return `<li><pre>${JSON.stringify(json, null, 2)}</pre></li>`;
    }).join("") + "</ul>";
});
  
