///////////////////////////////////////////////////////////////////////////
// PEG.js grammar for DSL: array of arrays, rule and state definitions
///////////////////////////////////////////////////////////////////////////

Program
  = _ first:Statement rest:(StmtSep Statement)* StmtSep? _ {
      return [ first ].concat(rest.map(item => item[1]));
    }

StmtSep
  = _ (";" / Newline)+ _

Newline
  = "\r\n" / "\n" / "\r"

CommentLine
  = "^" (!Newline .)* Newline

Statement
  = ArrayAssignment
  / RuleAssignment
  / StateAssignment

// 1) foo = (a,b)(c,d)
ArrayAssignment
  = name:Identifier _ "=" _ groups:ArrayGroup+ {
      return { type: "array", name, value: groups };
    }

// 2) @r = SeqItem -> SeqItem -> SeqItem
//    Restrict SeqItem here to only array groups or variable refs
RuleAssignment
  = name:RuleName _ "=" _ seq:SimpleExact3Sequence {
      return { type: "rule", name, sequence: seq };
    }

// 3) $s = source <~ SeqItem->SeqItem->SeqItem [count]
StateAssignment
  = name:StateName _ "=" _ source:(Identifier / InlineArray / StateName)+ _
    "<~" _ rulePart:(Exact3Sequence / RuleName) _ cnt:Integer? {
        return {
            type:  "state",
            name:  name,
            source: (Array.isArray(source) && source.length > 1 ? source : source[0]),
            rule:   typeof rulePart === "string"
                  ? [{ type:"ruleRef", name: rulePart }]
                  : rulePart,
            count:  cnt !== null ? parseInt(cnt, 10) : 5
      };
    }

// Sequence used in rule creation: only arrays or variable refs
SimpleExact3Sequence
  = first:SimpleSeqItem _ "->" _ second:SimpleSeqItem _ "->" _ third:SimpleSeqItem {
      return [ first, second, third ];
    }

SimpleSeqItem
  = grp:ArrayGroup           { return { type: "inline", value: grp }; }
  / ref:Identifier           { return { type: "varRef",  name: ref }; }

// Original for states: allows SeqItem or rule refs
Exact3Sequence
  = first:SeqItem _ "->" _ second:SeqItem _ "->" _ third:SeqItem {
      return [ first, second, third ];
    }

SeqItem
  = grp:ArrayGroup           { return { type: "inline", value: grp }; }
  / ref:RuleName             { return { type: "ruleRef", name: ref }; }
  / ref:Identifier           { return { type: "varRef",  name: ref }; }

InlineArray
  = groups:ArrayGroup+ { return groups; }

ArrayGroup
  = "(" _ elems:ElementList _ ")" {
      return elems;
    }

ElementList
  = head:Identifier tail:(_ "," _ Identifier)* {
      return [ head ].concat(tail.map(r => r[3]));
    }

Identifier
  = [a-zA-Z_][a-zA-Z0-9_]* {
      return text();
    }

RuleName
  = "@" [a-zA-Z_][a-zA-Z0-9_]* {
      return text().slice(1);
    }

StateName
  = "$" [a-zA-Z_][a-zA-Z0-9_]* {
      return text().slice(1);
    }

Integer
  = [0-9]+ {
      return text();
    }

_  = ( [ \t\r\n] / CommentLine )*  
