import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App.jsx";
import "antd/dist/reset.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#3ba8a0",
        colorText: "#4a404f",
        colorTextSecondary: "#8b8392",
        borderRadius: 8,
        fontSize: 13,
      },
    }}
  >
    <App />
  </ConfigProvider>
);
