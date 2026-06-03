export type NodeKind =
  | "request"
  | "resource"
  | "filter"
  | "sort"
  | "paginate"
  | "response"
  | "select"
  | "limit"
  | "delay"
  | "randomError";

export type SocketType = "request" | "records" | "record" | "value" | "boolean" | "response" | "error";

export type NodeSocket = { id: string; label: string; type: SocketType };
export type NodeConfigField = {
  key: string;
  label: string;
  defaultValue: string;
  options?: string[];
};

export type NodeSpec = {
  kind: NodeKind;
  title: string;
  category: "Input" | "Transform" | "Output" | "Advanced";
  beginner: boolean;
  summary: string;
  example: string;
  inputs: NodeSocket[];
  outputs: NodeSocket[];
  config: NodeConfigField[];
};

const socket = (id: string, label: string, type: SocketType): NodeSocket => ({ id, label, type });

export const nodeCatalog: NodeSpec[] = [
  {
    kind: "request",
    title: "HTTP Request",
    category: "Input",
    beginner: true,
    summary: "API endpointga kelgan requestni boshlaydi.",
    example: "GET /posts",
    inputs: [],
    outputs: [socket("request", "Request", "request")],
    config: [
      { key: "method", label: "Method", defaultValue: "GET", options: ["GET", "POST"] },
      { key: "path", label: "Path", defaultValue: "/posts" },
      { key: "body", label: "JSON body", defaultValue: "{\n  \"title\": \"New post\",\n  \"published\": true\n}" },
    ],
  },
  {
    kind: "resource",
    title: "Read Resource",
    category: "Input",
    beginner: true,
    summary: "Project ichidagi resource recordlarini o‘qiydi.",
    example: "posts",
    inputs: [socket("request", "Request", "request")],
    outputs: [socket("records", "Records", "records")],
    config: [
      { key: "project", label: "Project slug", defaultValue: "demo" },
      { key: "resource", label: "Resource", defaultValue: "posts" },
    ],
  },
  {
    kind: "filter",
    title: "Filter Records",
    category: "Transform",
    beginner: true,
    summary: "Recordlarni field qiymati bo‘yicha filtrlab beradi.",
    example: "published = true",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Filtered", "records")],
    config: [
      { key: "field", label: "Field", defaultValue: "published" },
      { key: "operator", label: "Operator", defaultValue: "=", options: ["=", "!=", ">", ">=", "<", "<="] },
      { key: "value", label: "Value", defaultValue: "true", options: ["true", "false"] },
    ],
  },
  {
    kind: "sort",
    title: "Sort Records",
    category: "Transform",
    beginner: true,
    summary: "Recordlarni field bo‘yicha tartiblaydi.",
    example: "created_at desc",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Sorted", "records")],
    config: [
      { key: "field", label: "Field", defaultValue: "created_at" },
      { key: "direction", label: "Direction", defaultValue: "desc", options: ["asc", "desc"] },
    ],
  },
  {
    kind: "paginate",
    title: "Pagination",
    category: "Transform",
    beginner: true,
    summary: "Recordlarni sahifalab qaytaradi.",
    example: "20 per page",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Page", "records")],
    config: [{ key: "size", label: "Page size", defaultValue: "20" }],
  },
  {
    kind: "response",
    title: "JSON Response",
    category: "Output",
    beginner: true,
    summary: "Flow natijasini JSON response sifatida qaytaradi.",
    example: "200 OK",
    inputs: [socket("records", "Body", "records")],
    outputs: [],
    config: [{ key: "status", label: "Status", defaultValue: "200", options: ["200", "201"] }],
  },
  {
    kind: "select",
    title: "Select Fields",
    category: "Advanced",
    beginner: false,
    summary: "Faqat kerakli fieldlarni response’da qoldiradi.",
    example: "id,title",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Selected", "records")],
    config: [{ key: "fields", label: "Fields", defaultValue: "id,title" }],
  },
  {
    kind: "limit",
    title: "Limit Records",
    category: "Advanced",
    beginner: false,
    summary: "Natijadan faqat birinchi N ta recordni qoldiradi.",
    example: "first 10",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Limited", "records")],
    config: [{ key: "count", label: "Count", defaultValue: "10" }],
  },
  {
    kind: "delay",
    title: "Response Delay",
    category: "Advanced",
    beginner: false,
    summary: "Mock API response’ini sekinlashtiradi.",
    example: "300 ms",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Delayed", "records")],
    config: [{ key: "milliseconds", label: "Delay", defaultValue: "300" }],
  },
  {
    kind: "randomError",
    title: "Random Error",
    category: "Advanced",
    beginner: false,
    summary: "Test uchun ba’zan xato response qaytaradi.",
    example: "10% -> 500",
    inputs: [socket("records", "Records", "records")],
    outputs: [socket("records", "Passed", "records")],
    config: [
      { key: "chance", label: "Chance %", defaultValue: "10" },
      { key: "status", label: "Status", defaultValue: "500", options: ["400", "404", "500"] },
    ],
  },
];

export function nodeSpec(kind: NodeKind) {
  return nodeCatalog.find((item) => item.kind === kind)!;
}

export function defaultConfig(kind: NodeKind) {
  return Object.fromEntries(nodeSpec(kind).config.map((field) => [field.key, field.defaultValue]));
}
