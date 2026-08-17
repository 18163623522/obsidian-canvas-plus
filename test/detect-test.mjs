// detect-core 自测：node detect-test.mjs
import { detectContent } from "./detect-core.mjs";

const cases = [
  // —— 代码（应识别，注意语言） ——
  ["#include <stdio.h>\nint main() {\n  printf(\"hi\");\n  return 0;\n}", "c"],
  ["#include <iostream>\nusing namespace std;\nint main() {\n  cout << \"hi\";\n}", "cpp"],
  ["def add(a, b):\n    return a + b\n\nprint(add(1, 2))", "python"],
  ["import numpy as np\nprint(np.pi)", "python"],
  ["const app = express();\napp.get('/', (req, res) => {\n  res.send('hi');\n});", "js"],
  ["let x: number = 5;\nconsole.log(x);", "ts"],
  ["int x = 42;", "cpp"],
  ["int add(int a, int b) {\n  return a + b;\n}", "c"],
  ["void main() {\n  gl_Position = vec4(pos, 1.0);\n}", "glsl"],
  ["uniform mat4 mvp;\nvarying vec2 uv;\nvoid main() {\n  gl_Position = mvp * vec4(pos, 1);\n}", "glsl"],
  ["cbuffer PerFrame : register(b0) {\n  float4x4 worldViewProj;\n};\nfloat4 main(float3 pos : POSITION) : SV_POSITION {\n  return mul(float4(pos, 1), worldViewProj);\n}", "hlsl"],
  ["fn main() {\n    let mut x = 5;\n    println!(\"{}\", x);\n}", "rust"],
  ["package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hi\")\n}", "go"],
  ["public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"hi\");\n    }\n}", "java"],
  ["SELECT id, name FROM users WHERE age > 18;", "sql"],
  ["<div class=\"box\">\n  <p>hello</p>\n</div>", "html"],
  ["#!/bin/bash\nmkdir -p dist\ncp -r src dist/", "bash"],
  ["local x = 1\nfunction add(a, b)\n  return a + b\nend", "lua"],
  // —— 公式 ——
  ["E = mc^2", "formula"],
  ["\\frac{a}{b} = \\sqrt{x}", "formula"],
  ["x_1 + x_2 = 10", "formula"],
  ["F = ma", "formula"],
  ["a = b", "formula"],
  ["y = sin(x) + cos(x)", "formula"],
  ["x = 1", "formula"],
  // —— 表格 ——
  ["姓名\t年龄\n张三\t18\n李四\t20", "table"],
  ["name,age,city\nTom,18,Beijing\nJerry,20,Shanghai", "table"],
  // —— 纯文本（不应识别） ——
  ["今天我们去公园散步，天气很好\n明天继续写代码", "null"],
  ["hello world", "null"],
  ["https://example.com/x=1", "null"],
  ["I like apples, oranges\nand bananas", "null"],
  ["买牛奶鸡蛋", "null"],
  ["a very normal sentence with = sign inside", "null"],
  ["the answer is 42", "null"],
  ["这是一个比较长的句子，包含等于号 = 但不应该识别", "null"],
  ["todo: 买牛奶", "null"],
];

let bad = 0;
for (const [input, expect] of cases) {
  const hit = detectContent(input);
  const got = hit ? (hit.kind === "code" ? hit.lang : hit.kind) : "null";
  const ok = got === expect;
  if (!ok) bad++;
  const show = input.replace(/\n/g, "\\n").replace(/\t/g, "→").slice(0, 44);
  console.log(`${ok ? "✓" : "✗ MIS"} [${got.padEnd(8)}] 期望[${expect.padEnd(8)}] ← ${show}`);
}
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 个不符`);
