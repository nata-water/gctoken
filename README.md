# gctoken

GitHub Copilot のローカルセッションログからトークン使用量と推定コスト（直接 API 利用時の参考価格）をワンライナーで取得する CLI ツールです。

> **Note:** 個人的な確認用途で作成したツールです。本リポジトリのコードは GitHub Copilot（コーディングエージェント）の支援を受けて作成しています。

## Usage

```bash
npx nata-water/gctoken

# オプション
npx nata-water/gctoken --today          # 今日のみ
npx nata-water/gctoken --month --models  # 今月 + モデル別
npx nata-water/gctoken --days 7 --json   # 直近7日をJSON出力
```

### Options

| Option             | Description                             |
| ------------------ | --------------------------------------- |
| `-t`, `--today`    | Show today's usage only                 |
| `-m`, `--month`    | Show current month's usage only         |
| `-d N`, `--days N` | Lookback N days (default: 30, max: 365) |
| `--models`         | Show per-model token breakdown          |
| `-j`, `--json`     | Output as JSON                          |
| `-h`, `--help`     | Show help                               |

### Example output

```
GitHub Copilot Usage (Today)
────────────────────────────────────────
Tokens:             98,503
  Input:            84,502
  Output:           14,001
  Thinking:         10,513
Interactions:           12
Sessions:                3
Est. Cost:         $0.6138
Scanned:               124 files
```

## How it works

VS Code が保存する GitHub Copilot のチャットセッションログ（`%APPDATA%/Code/User/` 配下）を読み取り、各リクエストのトークン使用量を集計します。トークン数が記録されていないセッションについては、文字数ベースの推定を行います。

## Acknowledgements

モデル別の料金データ (`modelPricing.json`) やトークン推定係数 (`tokenEstimators.json`) は、以下のリポジトリの知見を参照しています。

- [rajbos/github-copilot-token-usage](https://github.com/rajbos/github-copilot-token-usage)

## License

[MIT](./License.txt)
