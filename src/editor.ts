import * as ace from 'ace-builds'
import parser from './bundle/parser.js'

const server_url = "http://127.0.0.1:8001/evolve"

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
$final_test = $st_mixed <~ @grow 1;
`

const editor = ace.edit("editor")
editor.setOptions({
    fontSize: "14pt",
    showPrintMargin: false,
    wrap: true,
    value: tutorial, // используем ваш tutorial
});

const runButton = document.getElementById("run-button");
const panel = document.getElementById("detected-states");

const stateJsons = new Map<string, StateJson>()

type ASTNode = ArrayNode | RuleNode | StateNode;

type Hyperedge = { vertices: string[] };

interface StateJson {
    hypergraph: Hyperedge[] | StateJson;
    rule: { L: Hyperedge[], I: Hyperedge[], R: Hyperedge[] };
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
    rule: RuleNode | SeqItem[];
    count: number | null;
}

type SeqItem =
    | { type: "inline", value: string[] }
    | { type: "varRef", name: string }
    | { type: "ruleRef", name: string };

function validateAST(ast: ASTNode[], states: StateNode[]) {
    const variables = new Set<string>();
    const rules = new Set<string>();
    const stateNames = new Set(states.map(s => s.name));
    const errors: string[] = [];

    for (const node of ast) {
        if (node.type === "array") variables.add(node.name);
        if (node.type === "rule") rules.add(node.name);
    }

    for (const node of ast) {
        if (node.type === "rule" || node.type === "state") {
            const seq = node.type === "rule" ? node.sequence :
                Array.isArray(node.rule) ? node.rule : node.rule.sequence;

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
            if (!variables.has(node.source) && !stateNames.has(node.source)) {
                errors.push(`Unknown variable or state '${node.source}' in state '${node.name}'`);
            }
        }
    }

    return errors;
}

// TODO может сделать это менее топорным??
editor.on("change", function (delta) {
    const cursor = editor.selection.getCursor();
    const line = editor.session.getLine(cursor.row); 

    if (delta.action === "insert" && delta.lines.length > 1) {
        console.log("Переход на новую строку!");
        handleRun()
    }
});

function handleRun() {
    let ast: ASTNode[];
    try {
        ast = parser.parse(editor.getValue()) as ASTNode[];
    } catch (e: any) {
        console.error("Parse error:", e.message);
        return;
    }

    const arrays = new Map<string, string[][]>();
    const rules = new Map<string, RuleNode>();
    const states: StateNode[] = [];

    for (const node of ast) {
        if (node.type === "array") {
            arrays.set(node.name, node.value);
        } else if (node.type === "rule") {
            rules.set(node.name, node);
        } else {
            states.push(node);
        }
    }

    const errors = validateAST(ast, states);
    if (errors.length) {
        console.error("Semantic errors:\n" + errors.join("\n"));
        return;
    }

    panel!.innerHTML = "<ul>" + states.map(state => {
        const json = buildStateJson(state, arrays, rules, states);
        stateJsons.set(state.name, json);
        return `<li><pre>${state.name}</pre><button class="${state.name}">▶︎</button></li>`;
    }).join("") + "</ul>";
};

panel?.addEventListener("click", async (e) => {
    const btn = e.target as HTMLElement;
    if (!(btn instanceof HTMLButtonElement)) return;
    const stateName = btn.className;
    const json = stateJsons.get(stateName);
    if (!json) {
        console.error(`No JSON found for state '${stateName}'`);
        return;
    }

    try {
        const response = await fetch(server_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);

        const result = await response.json();
        console.log(`Server response for '${stateName}':`, result);
        alert(`State '${stateName}' successfully sent to server!`);
    } catch (error) {
        console.error(`Failed to send state '${stateName}':`, error);
        alert(`Failed to send state '${stateName}' to server`);
    }
});

function buildStateJson(state: StateNode, arrays: Map<string, string[][]>, rules: Map<string, RuleNode>, allStates: StateNode[]): StateJson {
    const resolveToVertices = (item: SeqItem): string[][] => {
        if (item.type === "inline") return [item.value];
        if (item.type === "varRef") return arrays.get(item.name) || [];
        if (item.type === "ruleRef") {
            const rule = rules.get(item.name);
            return rule ? rule.sequence.flatMap(resolveToVertices) : [];
        }
        return [];
    };

    const buildHypergraph = (source: string | string[][]): Hyperedge[] => {
        if (typeof source === "string") {
            const arr = arrays.get(source);
            if (arr) return arr.map(v => ({ vertices: v }));
            const ref = allStates.find(s => s.name === source);
            return ref ? buildHypergraph(ref.source) : [];
        }
        return source.map(v => ({ vertices: v }));
    };

    const seq = Array.isArray(state.rule) ? state.rule : state.rule.sequence;
    const flatSeq = seq.flatMap(item => item.type === "ruleRef" && rules.has(item.name) ? rules.get(item.name)!.sequence : [item]);

    return {
        hypergraph: buildHypergraph(state.source),
        rule: {
            L: flatSeq.length > 0 ? resolveToVertices(flatSeq[0]).map(v => ({ vertices: v })) : [],
            I: flatSeq.length > 1 ? resolveToVertices(flatSeq[1]).map(v => ({ vertices: v })) : [],
            R: flatSeq.length > 2 ? resolveToVertices(flatSeq[2]).map(v => ({ vertices: v })) : [],
        },
        steps: state.count,
        clean: true,
    };
}
