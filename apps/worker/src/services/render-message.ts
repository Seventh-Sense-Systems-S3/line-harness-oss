// broadcast 配信時に message_content 内のテンプレ変数を置換する純関数。
// 配信先 LINE アカウントに対応した liff_id を埋め込むのが目的:
// 1 broadcast から複数アカへ multi-account-dedup で配信する際、メッセージ
// 内の URL を各友だちの所属アカに合わせて差し替える。
//
// 将来テンプレ変数 (display_name, user_id, ...) を追加する場合はこの
// 関数を拡張する。
export function renderMessageContent(content: string, liffId: string | null): string {
  if (!liffId) return content;
  return content.replaceAll('{{liff_id}}', liffId);
}
