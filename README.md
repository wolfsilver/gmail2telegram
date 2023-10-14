# gmail2telegram

利用cloudflare email workers，将Gmail发送到telegram，并提供全文预览。

### 项目介绍

telegram 自带的Gmail bot，接收消息有延时，这个项目利用cloudflare email workers，将Gmail发送到telegram，并提供全文预览。

### 部署

```shell
git clone git@github.com:wolfsilver/gmail2telegram.git
# 复制配置模板，修改成自己的telegram配置
cp wrangler.example.toml wrangler.toml 
pnpm & pnpm dep
```
