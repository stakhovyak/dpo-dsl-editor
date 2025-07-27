# DSL frontend

## Syntax

<p align="center">
  <img src="https://github.com/stakhovyak/dpo-dsl-editor/blob/main/images/ed.png" alt="sparrow logo" width="300" height="300"/>
</p>


## Objects

### Basic variables

when we write:

```
foo = (x,y)(a,b,c)
```

We get:

```json
[
  {
    "type": "array",
    "name": "foo",
    "value": [
      [
        "x",
        "y"
      ],
      [
        "a",
        "b",
        "c"
      ]
    ]
  }
]
```

### Rules

When we write

```
@grow = (A)->(B,x,y)->(C)
```

We get:

```json
{
  "type": "rule",
  "name": "grow",
  "sequence": [
    [
      "A"
    ],
    [
      "B",
      "x",
      "y"
    ],
    [
      "C"
    ]
  ]
}
```

### States

When we write

```
$state3 = (x)(y,z) <~ (R)->(S,T)->(U) 1
```

```json
[
  {
    "type": "state",
    "name": "state3",
    "source": [
      [
        "x"
      ],
      [
        "y",
        "z"
      ]
    ],
    "rule": [
      [
        "R"
      ],
      [
        "S",
        "T"
      ],
      [
        "U"
      ]
    ],
    "count": 1
  }
]
```

By the way, count is optional so we can ommit writing the number of iterations,
it will pick the default one.

### All together

```
@grow = (A) -> (B,x,y) -> (C);
just_var = (B)(c);
$s = (A) <~ (B) -> (s,s,s) -> (g, g) 4;
@another_rule = (A) -> (x, q, c) -> (p);
```

### Variables storage

```
@grow = (A)->(B,x,y)->(C);
just_var = (B)(c);
$st1 = (A) <~ @grow 5;
@another = just_var->just_var->(p);
```
