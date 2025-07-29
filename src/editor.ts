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
`;


const editor = ace.edit("editor")
editor.setOptions({
    fontSize: "14pt",
    showPrintMargin: false,
    wrap: true,
    value: tutorial, // используем ваш tutorial
});

const runButton = document.getElementById("run-button");
const sendButton = document.getElementById("send-button")

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

const stateJsons: StateJson[] = [];

runButton?.addEventListener("click", () => {
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

    const panel = document.getElementById("detected-states")!;
    panel.innerHTML = "<ul>" + states.map(state => {
        const resolveToVertices = (item: SeqItem): string[][] => {
            if (item.type === "inline") {
                return [item.value];
            } else if (item.type === "varRef") {
                return arrays.get(item.name) || [];
            } else if (item.type === "ruleRef") {
                const rule = rules.get(item.name);
                return rule ? rule.sequence.flatMap(resolveToVertices) : [];
            }
            return [];
        };

        const buildHypergraph = (source: string | string[][]): Hyperedge[] => {
            if (typeof source === "string") {
                const array = arrays.get(source);
                if (array) return array.map(vertices => ({ vertices }));

                const refState = states.find(s => s.name === source);
                if (refState) return buildHypergraph(refState.source);

                return [];
            }
            return source.map(vertices => ({ vertices }));
        };

        let ruleSequence: SeqItem[];
        if (Array.isArray(state.rule)) {
            ruleSequence = state.rule;
        } else {
            ruleSequence = state.rule.sequence;
        }

        const resolvedSequence = ruleSequence.flatMap(item => {
            if (item.type === "ruleRef") {
                const rule = rules.get(item.name);
                return rule ? rule.sequence : [];
            }
            return [item];
        });

        const L = resolvedSequence.length > 0
            ? resolveToVertices(resolvedSequence[0]).map(vertices => ({ vertices }))
            : [];

        const I = resolvedSequence.length > 1
            ? resolveToVertices(resolvedSequence[1]).map(vertices => ({ vertices }))
            : [];

        const R = resolvedSequence.length > 2
            ? resolveToVertices(resolvedSequence[2]).map(vertices => ({ vertices }))
            : [];

        const hypergraph = buildHypergraph(state.source);

        const json: StateJson = {
            hypergraph,
            rule: {
                "L": L,
                "I": I,
                "R": R
            },
            steps: state.count,
            clean: true
        };

        stateJsons.push(json);
        return `<li><pre>${JSON.stringify(json, null, 2)}</pre></li>`;
    }).join("") + "</ul>";
});

sendButton?.addEventListener("click", async () => {
    if (stateJsons.length === 0) {
        console.error("No states to send");
        return;
    }

    const lastState = stateJsons[stateJsons.length - 1];

    try {
        const response = await fetch(server_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastState),
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);

        const result = await response.json();
        console.log("Server response:", result);
        alert("State successfully sent to server!");
    } catch (error) {
        console.error("Failed to send state:", error);
        alert("Failed to send state to server");
    }
});