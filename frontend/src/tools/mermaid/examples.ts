export const flowchartExample = `flowchart LR
  A[提交申请] --> B{信息完整?}
  B -- 是 --> C[进入审批]
  B -- 否 --> D[补充材料]
  D --> A
  C --> E[完成]`

export const sequenceExample = `sequenceDiagram
  participant User as 用户
  participant App as KAITools
  participant API as 服务接口
  User->>App: 发送请求
  App->>API: HTTP Request
  API-->>App: Response
  App-->>User: 展示结果`
