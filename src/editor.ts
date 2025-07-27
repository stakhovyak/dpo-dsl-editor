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
    value: tutorial,
});

const runButton = document.getElementById("run-button");
const sendButton = document.getElementById("send-button")

type ASTNode = ArrayNode | RuleNode | StateNode;

type Hyperedge = { vertices: string[] };

interface StateJson {
    hypergraph: Hyperedge[] | StateJson;
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
    isLIR: boolean;
    L?: SeqItem;
    I?: SeqItem;
    R?: SeqItem;
    sequence?: SeqItem[];
}

interface StateNode {
    type: "state";
    name: string;
    source: string | string[][] | StateNode;
    rule: RuleNode | SeqItem[] | any;
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
            let seq: SeqItem[] = [];

            if (node.type === "rule") {
                if (node.isLIR && node.L && node.I && node.R) {
                    seq = [node.L, node.I, node.R];
                } else if (node.sequence) {
                    seq = node.sequence;
                }
            } else {
                if (Array.isArray(node.rule)) {
                    seq = node.rule;
                } else if (node.rule.isLIR && node.rule.L && node.rule.I && node.rule.R) {
                    seq = [node.rule.L, node.rule.I, node.rule.R];
                } else if (node.rule.sequence) {
                    seq = node.rule.sequence;
                }
            }

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

    for (const stateNode of states) {
        if (Array.isArray(stateNode.rule)) {
            for (let i = 0; i < stateNode.rule.length; i++) {
                const item = stateNode.rule[i];
                if (item.type === "ruleRef") {
                    const rule = rules.get(item.name);
                    if (rule) {
                        stateNode.rule[i] = rule;
                    }
                }
            }
        } else if (stateNode.rule.type === "ruleRef") {
            const rule = rules.get(stateNode.rule.name);
            if (rule) {
                stateNode.rule = rule;
            }
        }
    }

    const errors = validateAST(ast, states);
    if (errors.length) {
        console.error("Semantic errors:\n" + errors.join("\n"));
        return;
    }

    const panel = document.getElementById("detected-states")!;
    panel.innerHTML = "<ul>" + states.map(state => {
        const unfold = (item: SeqItem | RuleNode): string[][] => {
            if ("type" in item) {
                if (item.type === "inline") {
                    return [item.value];
                } else if (item.type === "varRef") {
                    return arrays.get(item.name) ?? [];
                } else if (item.type === "ruleRef") {
                    const rule = rules.get(item.name);
                    return rule ? unfold(rule) : [];
                }
            }

            const ruleNode = item as RuleNode;
            if (ruleNode.isLIR && ruleNode.L && ruleNode.I && ruleNode.R) {
                return [
                    ...unfold(ruleNode.L),
                    ...unfold(ruleNode.I),
                    ...unfold(ruleNode.R)
                ];
            } else if (ruleNode.sequence) {
                return ruleNode.sequence.flatMap(unfold);
            }
            return [];
        };

        const buildHypergraph = (source: string | string[][] | StateNode): Hyperedge[] | StateJson => {
            if (typeof source === "string") {
                const referencedState = states.find(s => s.name === source);
                if (referencedState) {
                    return {
                        hypergraph: buildHypergraph(referencedState.source),
                        rule: {}, // Placeholder
                        steps: referencedState.count,
                        clean: true
                    };
                } else {
                    const array = arrays.get(source) ?? [];
                    return array.map(g => ({ vertices: g }));
                }
            } else if (Array.isArray(source)) {
                return source.map(g => ({ vertices: g }));
            } else {
                return {
                    hypergraph: buildHypergraph(source.source),
                    rule: {}, // Placeholder
                    steps: source.count,
                    clean: true
                };
            }
        };

        const hypergraph = buildHypergraph(state.source);

        const toHyperedges = (item: SeqItem | RuleNode): Hyperedge[] =>
            unfold(item).map(vertices => ({ vertices }));

        const ruleObj: Record<string, Hyperedge[]> = {};

        if (Array.isArray(state.rule)) {
            if (state.rule.length === 3) {
                ruleObj["L"] = toHyperedges(state.rule[0]);
                ruleObj["I"] = toHyperedges(state.rule[1]);
                ruleObj["R"] = toHyperedges(state.rule[2]);
            } else {
                ruleObj["rule"] = state.rule.flatMap(item =>
                    unfold(item).map(vertices => ({ vertices }))
                );
            }
        } else {
            if (state.rule.isLIR && state.rule.L && state.rule.I && state.rule.R) {
                ruleObj["L"] = toHyperedges(state.rule.L);
                ruleObj["I"] = toHyperedges(state.rule.I);
                ruleObj["R"] = toHyperedges(state.rule.R);
            }
            else if (state.rule.sequence) {
                ruleObj["rule"] = state.rule.sequence.flatMap((item: RuleNode | SeqItem) =>
                    unfold(item).map(vertices => ({ vertices }))
                );
            }
        }

        const json: StateJson = {
            hypergraph,
            rule: ruleObj,
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
        const response = await sendToServer(lastState);
        console.log("Server response:", response);
        alert("State successfully sent to server!");
    } catch (error) {
        console.error("Failed to send state:", error);
        alert("Failed to send state to server");
    }
});

async function sendToServer(data: StateJson): Promise<unknown> {
    const response = await fetch(server_url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
    }

    return response.json();
}