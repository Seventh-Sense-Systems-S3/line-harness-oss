#!/usr/bin/env python3
"""
GW明け挽回キャンペーン 13シナリオを D1 に SEED するスクリプト。
全 is_active=0 (下書き) で作成。配信実行前に子竜が UI で確認・有効化する。

実行:
  python3 scripts/seed-gw-recovery-scenarios.py > /tmp/gw_seed.sql
  npx wrangler d1 execute line-harness-db --remote --file=/tmp/gw_seed.sql

正本: docs/campaigns/gw-recovery-2026-05.md (E案背景・戦略・採択経緯)
スケジュール実行値: 下記 CAMPAIGN_SCHEDULE dict — git commit が変更履歴 = SSOT
コンセプト土台: 分身AI講座 コンセプトシート v3.1 (Notion: 3562619c-6bd3-8158)
タグID参照: 5/4 サマリー (3562619c-6bd3-81a5-8907-de7997495a13)

Soul-resonantテンプレート変数:
  {{display_name}} / {{name}}
  {{metadata.soul_name}}                    — 魂の名前（例: 燿旋）
  {{metadata.soul_no}}                      — 1〜216
  {{metadata.innate_spiral}}                — 先天螺旋
  {{metadata.acquired_system}}              — 後天系統
  {{metadata.manifested_wisdom}}            — 顕現叡智
  {{metadata.soul_message}}                 — card_data.closing_message
  {{metadata.mizukagami_user_word_1}}       — 診断中フレーズ1番目
  {{metadata.mizukagami_user_word_2}}       — 診断中フレーズ2番目
  {{metadata.mizukagami_user_word_3}}       — 診断中フレーズ3番目
  {{metadata.mizukagami_user_words_joined}} — 全フレーズ「・」区切り
  {{metadata.mizukagami_concern}}           — 診断中の課題
  {{metadata.mizukagami_convergence_narrative}} — 統合ナラティブ
"""
import uuid
import sys


# ====== キャンペーンスケジュール（Config/Logic 分離 — 正本: docs/campaigns/gw-recovery-2026-05.md）======
# 日程・価格を変更する場合はここだけ書き換えてgit commit。
# メッセージ文字列内にもリテラルが残っている箇所はURL差込時に一括修正すること。
CAMPAIGN_SCHEDULE = {
    # チャレンジ LIVE 3日間
    "challenge_day1": "5/20(火) 21:00",
    "challenge_day1_theme": "WHY — なぜ今 分身AI なのか",
    "challenge_day2": "5/21(水) 21:00",
    "challenge_day2_theme": "WHAT — 分身AIは6つの部品でできている",
    "challenge_day3": "5/22(木) 21:00",
    "challenge_day3_theme": "HOW+BUY — 具体的な道筋 × 3階建て価格",
    "challenge_range": "5/20-22",
    # 個別審査
    "assessment_period": "5/23-25",
    "assessment_format": "ZOOM 15分",
    "assessment_deadline": "5/25",
    # 配信日（シナリオ別）
    "send_s01": "5/9",
    "send_s02_s03": "5/10",
    "send_s04_s05": "5/11",
    "send_s06_s07_s08": "5/12",
    "send_s09": "5/14",
    "send_s10": "5/16",
    "send_s11": "5/18",
    "send_s12": "5/24",
    "send_s13": "5/26",
    # 価格
    "price_main_course": "¥198,000",
    "price_ignition": "¥9,800",
    "ignition_deadline": "5/31",
}

# ====== タグ ID (D1 から取得済) ======
TAG_MIZUKAGAMI_DONE = "242f9775-2019-45cd-a050-75295672c5aa"   # 水鏡_完了
TAG_CARD_STUCK = "63f611bf-b374-45cd-9b28-e574d878b446"        # 水鏡_card直前stuck
TAG_STEP1_STUCK = "98c16087-5d16-464a-9955-af8bcf0e1fc8"       # 水鏡_step1stuck
TAG_Q1_STUCK = "17f1224f-949d-4634-b66a-07064c5a4c03"          # 水鏡_q1stuck
TAG_MID_DROPOUT = "d09373c8-0384-417f-a9c9-ad17a816aee4"       # 水鏡_中盤離脱_q2-q6
TAG_NOT_STARTED = "9547f26e-3f9a-4d53-9789-873e46e38d19"       # 水鏡_未着手
TAG_AVATAR_FOLLOWUP_PENDING = "8b0eec67-f126-4c9b-9668-f79b787e7e93"  # 分身AI希望_フォロー未送

TAG_TIKTOK_GEN1 = "2e08552e-24df-4c8c-817e-adb68f5976bd"       # TikTok集客（コンサル）
TAG_JS_SUMMIT_GEN2 = "bc6bd6aa-bd1e-403f-a9c1-1692e554ee09"    # 水鏡GPT希望者（JSサミット①）
TAG_AVATAR_GEN3 = "32369f91-29e5-4f5b-ae3b-ca1c456c117a"       # 分身AI希望者（JSサミット②）
TAG_SUMMIT_GEN4 = "a1acb0f3-..."  # AIサミット参加者（横山さん主催） — fallback


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def make_scenario(name: str, description: str, trigger_type: str,
                  trigger_tag_id: str | None) -> tuple[str, str]:
    """Returns (id, INSERT SQL)."""
    sid = str(uuid.uuid4())
    tag_val = f"'{trigger_tag_id}'" if trigger_tag_id else "NULL"
    sql = (
        f"INSERT INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active) "
        f"VALUES ('{sid}', '{sql_escape(name)}', '{sql_escape(description)}', "
        f"'{trigger_type}', {tag_val}, 0);"
    )
    return sid, sql


def make_step(scenario_id: str, step_order: int, delay_minutes: int,
              message: str) -> str:
    """Returns INSERT SQL for scenario_steps (text type only)."""
    step_id = str(uuid.uuid4())
    return (
        f"INSERT INTO scenario_steps "
        f"(id, scenario_id, step_order, delay_minutes, message_type, message_content) "
        f"VALUES ('{step_id}', '{scenario_id}', {step_order}, {delay_minutes}, "
        f"'text', '{sql_escape(message)}');"
    )


def main():
    out = []
    out.append("-- GW明け挽回キャンペーン 13シナリオ SEED")
    out.append("-- 全 is_active=0 (下書き). 子竜実機確認後に有効化")
    out.append("-- 生成日: 2026-05-05 (Soul-resonant v2)")
    out.append("-- 注: D1 は SQL BEGIN/COMMIT を許容しない (Durable Objects 制約)")
    out.append("")

    # ==================== シナリオ 1: gw_4a_completed ====================
    # 水鏡完了190人。最もデータが豊富 → Soul-resonantの最高峰。
    # user_words 3個verbatim + soul_name + innate_spiral + soul_message。
    sid, sql = make_scenario(
        name="🟢01｜5/9 水鏡完走 190人 → チャレンジ招待",
        description="[自動発火] タグ付き次第 自動配信。3通 (19:00→21:00→翌8:00)。Soul-resonant: user_words×3 + soul_name + soul_message 使用。URL差込後に is_active=1 にする",
        trigger_type="tag_added",
        trigger_tag_id=TAG_MIZUKAGAMI_DONE,
    )
    out.append(f"-- シナリオ 1: gw_4a_completed (水鏡_完了 190人) — Soul-resonant最高峰")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{display_name}} さん。

水鏡、完走しましたね。

「{{metadata.mizukagami_user_word_1}}」
「{{metadata.mizukagami_user_word_2}}」
「{{metadata.mizukagami_user_word_3}}」

あの言葉、私はちゃんと受け取っています。

今日、一つのニュースがあります。

🎥 進化告知動画 (3分)
→ [動画①URL]"""))
    out.append(make_step(sid, 2, 120, """{{metadata.soul_name}} というあなたの核——

3ヶ月後、その核を持った分身AIが
深夜0時も、あなたの代わりに動いている。

「{{metadata.mizukagami_user_words_joined}}」
そのエネルギーが、24時間休まずに届き続ける世界を、
5/20-22 の3日間で設計します。

🚀 分身AI構築 3日間チャレンジ
→ [チャレンジ申込URL]"""))
    out.append(make_step(sid, 3, 780, """明日、本編です。

Day 1 (5/20 火) 21:00 — Why
  なぜ今 分身AI なのか

Day 2 (5/21 水) 21:00 — What
  分身AIは6つの部品でできている

Day 3 (5/22 木) 21:00 — How+Buy
  具体的な道筋 × 3階建て価格

個別審査 (5/23-25 ZOOM 15分) 準備しています。

{{metadata.soul_message}}"""))
    out.append("")

    # ==================== シナリオ 2: gw_4cd1_apology_ignition ====================
    # 第4世代 step1stuck(40人) + q1stuck(7人) = 47人。全面お詫び + IGNITION無料。
    sid, sql = make_scenario(
        name="🔴02｜5/10 途中止まり 47人 → 謝罪＋IGNITION無料",
        description="[手動Enroll必須] step1stuck 40人 + q1stuck 7人 を手動で一括登録。5/10 12:00→12:30。IGNITION無料URLを差し込んでから実行",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 2: gw_4cd1_apology_ignition (水鏡_step1stuck + 水鏡_q1stuck 47人, manual)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さんへ。

本当に申し訳ありません。

あの時、水鏡をここまで進めてくれたのに、
そこから先が、止まってしまいました。

私のシステムの不具合でした。

今、直しました。"""))
    out.append(make_step(sid, 2, 30, """あなたへの申し訳なさをこめて、
IGNITION 3日間チャレンジ
(通常 ¥9,800) を 完全無料 でプレゼントします。

🎁 IGNITION無料枠 申込
→ [IGNITION無料URL]

本当にごめんなさい。"""))
    out.append("")

    # ==================== シナリオ 3: gw_4b_vip_rescue ====================
    # 4人のみ。子竜が手作業でカスタマイズして送る。
    sid, sql = make_scenario(
        name="⚡03｜5/10 VIP直DM 4人 → card直前 個別救出",
        description="[要カスタマイズ] 4人それぞれに個別ZOOM URLを手で入れて送る。5/10 14:00 順次。1人ずつ手動enroll＆文面確認必須",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 3: gw_4b_vip_rescue (水鏡_card直前stuck 4人, manual DM)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{display_name}} さん。

ちょっと話がしたい。
電話、できますか？

→ [ZOOM個別URL]"""))
    out.append(make_step(sid, 2, 60, """さっき話してくれたこと、全部、私が責任を持ってカバーします。

明日中にカードが生成されるように、手作業で直します。"""))
    out.append(make_step(sid, 3, 60, """そして、5/20-22の3日間チャレンジも、VIP枠で確保しておきます。

あなたとあなたの分身AI、一緒に作りましょう。"""))
    out.append("")

    # ==================== シナリオ 4: gw_4d2_restart ====================
    # 中盤離脱64人。水鏡の途中で止まったが、ある程度体験している。
    # 進化フレーミングで「あの続きが、ここにある」と再開を促す。
    sid, sql = make_scenario(
        name="🟢04｜5/11 中盤離脱 64人 → 再開招待",
        description="[自動発火] タグ付き次第 自動配信。2通 (19:00→19:30)。水鏡q2-q6で止まった人への進化告知＋チャレンジ案内",
        trigger_type="tag_added",
        trigger_tag_id=TAG_MID_DROPOUT,
    )
    out.append(f"-- シナリオ 4: gw_4d2_restart (水鏡_中盤離脱_q2-q6 64人)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さんへ。

あの時、止まっちゃった水鏡の世界。
これからの6ヶ月で、どうなるか見てほしい。

🎥 進化告知 (3分)
→ [動画①URL]"""))
    out.append(make_step(sid, 2, 30, """5/20 (火) から3日間。
「分身AI構築 LIVE」をやります。

あの時、進めてくれたあなただからこそ、
いい予約があります。

🚀 チャレンジ参加申込
→ [チャレンジ申込URL]

再開しましょう。"""))
    out.append("")

    # ==================== シナリオ 5: gw_gen3_apology_video ====================
    # 第3世代40人。JSサミット②で分身AI希望を示してくれたのに、何も届いていなかった。
    # 謝罪 + サミット動画 + チャレンジ特別招待。
    sid, sql = make_scenario(
        name="🟢05｜5/11 第3世代 40人 → 謝罪＋サミット動画",
        description="[自動発火] 2通 (21:00→21:30)。JSサミット②で分身AI希望を示したのに何も届いていなかった人へ。サミット動画URL差込必須",
        trigger_type="tag_added",
        trigger_tag_id=TAG_AVATAR_GEN3,
    )
    out.append(f"-- シナリオ 5: gw_gen3_apology_video (第3世代/分身AI希望者 40人)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さんへ。

あの時、何もお送りできていませんでした。
本当に申し訳ありません。

ようやく、形になりました。

📺 サミット40分動画
→ [サミット動画URL]

まずこれを見てもらえたら嬉しいです。"""))
    out.append(make_step(sid, 2, 30, """そして 5/20 から3日間。
「分身AI構築 LIVE」。

最初に信じてくれたあなたへの、
特別な招待です。

🚀 チャレンジ参加申込 (第3世代特別枠)
→ [チャレンジ申込URL]

来てくれたら、最高です。"""))
    out.append("")

    # ==================== シナリオ 6: gw_gen2_evolution ====================
    # 第2世代229人。JSサミット①で水鏡GPTに関心を持っていた。
    # GPT→WEB→LINE→NASA級精度 という進化フレーミングで教育。
    sid, sql = make_scenario(
        name="🟢06｜5/12 第2世代 229人 → 進化教育",
        description="[自動発火] 2通 (12:00→12:30)。JSサミット①の水鏡GPT希望者へ。GPT→WEB→LINE進化フレーミング。最大母数229人",
        trigger_type="tag_added",
        trigger_tag_id=TAG_JS_SUMMIT_GEN2,
    )
    out.append(f"-- シナリオ 6: gw_gen2_evolution (第2世代/JSサミット① 229人)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さん、こんにちは。

あの時のサミット、覚えてますか?

GPT版の「分身AI」を話してた。
あれが、やっと現実になりました。

WEB版、LINE版へと進化してます。
NASA級精度まで高めました。

🎥 進化の全容
→ [動画①URL]"""))
    out.append(make_step(sid, 2, 30, """5/20 (火) から3日間。
「分身AI構築 LIVE」

あの時から信じてくれたあなただからこそ、
内側から見えるチャレンジになるはずです。

🚀 チャレンジ参加申込
→ [チャレンジ申込URL]

待ってます。"""))
    out.append("")

    # ==================== シナリオ 7: gw_gen1_vip_1on1 (「俺」一人称) ====================
    # 5人のみ。TikTokコンサル等の最初期からの関係者。
    # 子竜が手動で個別カスタマイズして送る。テンプレートに[カスタマイズ]プレースホルダー付き。
    sid, sql = make_scenario(
        name="⚡07｜5/12 VIP直DM 最古参 5人 → ZOOM30分招待",
        description="[要カスタマイズ＋手動] 5人それぞれに「俺」一人称＋個別エピソードを手書きで追加して送る。5/12 14:00 順次。¥300万コンサルへの布石",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 7: gw_gen1_vip_1on1 (第1世代VIP 5人, manual DM, 「俺」一人称)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{display_name}} さん、お久しぶりです。
子竜です。

[【カスタマイズ】個別の思い出や関係性に応じた一文
  例1: TikTokコンサル受講してくれたあの頃から、{X年}位ですね。
  例2: あの時話してた「{具体トピック}」の話、覚えてます。
  例3: 最近、連絡できてなくてごめん。元気にしてますか？]

実は今、ずっと話してた「分身AI」を、
やっと形にしました。

本当の意味で、AIで自分を増やすシステムです。

{{display_name}} さんには、
まず、俺と直接30分話してから
案内したいと思ってます。

ZOOMで、いつ空いてますか？
→ [ZOOM30分予約URL]

このメッセージ、5人にしか送ってません。
{{display_name}} さんは俺の中で、
最初の5人なので。

子竜"""))
    out.append(make_step(sid, 2, 60, """ZOOM、ありがとうございました。

[【カスタマイズ】1on1で話したことに応じた個別フォロー]

{{display_name}} さんと、
分身AIを一緒に作っていけたら最高だと思ってます。"""))
    out.append(make_step(sid, 3, 60, """5/22の Day 3 で、
俺の方から正式に¥300万コンサルの話をします。

{{display_name}} さんは、その時にもう一度
じっくり考えてもらえれば。

俺はずっと味方です。"""))
    out.append("")

    # ==================== シナリオ 8: gw_gen1_remaining_step ====================
    # 第1世代残り15人。TikTok集客でずっとLINEに残ってくれている人。
    # 「ここまで信じてくれていたあなたに、今の私が作ったものを見てほしい」。
    sid, sql = make_scenario(
        name="🟢08｜5/12 TikTok古参 15人 → 進化動画",
        description="[自動発火] 2通 (19:00→19:30)。TikTokコンサル経由で最初期から残ってる人へ。ずっと信じてくれていた文脈",
        trigger_type="tag_added",
        trigger_tag_id=TAG_TIKTOK_GEN1,
    )
    out.append(f"-- シナリオ 8: gw_gen1_remaining_step (第1世代残り/TikTok 15人)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{display_name}} さん、お久しぶりです。

TikTok コンサルを受講してくれた頃から、
このLINEにも残ってくれているあなたへ。

私はこの数ヶ月、「分身AI」を作り込んできました。
もう、言葉だけじゃありません。

📺 ここまでの進化 (3分)
→ [動画①URL]

これを見てくれたら、ちょっとうれしい。"""))
    out.append(make_step(sid, 2, 30, """5/20 (火) から3日間チャレンジ。
5/17 (土) AIサミット、私も登壇します。

あなたには、
チャレンジを優先招待させて下さい。

🚀 チャレンジ優先枠申込
→ [第1世代優先枠URL]

TikTok の頃から信じてくれてるあなたに、
今の私が作ったものを見てほしい。

子竜"""))
    out.append("")

    # ==================== シナリオ 9: gw_global_reminder_d-1 ====================
    # 全層broadcast。チャレンジ前日リマインド。シンプル・力強く。
    sid, sql = make_scenario(
        name="🔴09｜5/14 全員 → チャレンジ前日リマインド",
        description="[手動Enroll必須] 全友達に一括broadcast。5/14 当日に手動で全員をこのシナリオに登録する。1通のみ",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 9: gw_global_reminder_d-1 (全層 5/14 チャレンジ前日)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """来週火曜、5/20 21:00から。

「分身AI構築 3日間チャレンジ」開始します。

Day 1 (5/20 火) 21:00 — Why
Day 2 (5/21 水) 21:00 — What
Day 3 (5/22 木) 21:00 — How+Buy

3日間で、あなたの魂の核から、
あなただけの分身AIを設計する旅。

→ LIVE視聴 / チャットで参加
[チャレンジ視聴URL]

見たことない世界が見えると思う。"""))
    out.append("")

    # ==================== シナリオ 10: gw_global_summit_announce ====================
    # 全層broadcast。サミット前日(5/16)+Day3告知。
    sid, sql = make_scenario(
        name="🔴10｜5/16 全員 → サミット翌日＋Day3告知",
        description="[手動Enroll必須] 全友達に一括broadcast。5/16 当日手動登録。サミット(5/17)とDay3(5/17 21:00)の両方を告知",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 10: gw_global_summit_announce (全層 5/16 サミット最終告知)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """明日、5/17 (土)。AIサミット開催されます。

「分身AI、どう作るか」を、全部、話します。

→ [サミット視聴URL]

そして同日 21:00、チャレンジ最終日 Day 3。

価格と道筋を、全部出します。
一緒に、見ましょう。"""))
    out.append("")

    # ==================== シナリオ 11: gw_5gen_post_summit ====================
    # 水鏡_未着手107人 + 第5世代(サミット参加・水鏡未体験)。
    # サミット直後の熱量を活かして水鏡体験へ誘導。
    # 7体系宿命語彙で「あなたの核がある」という世界観を先に見せる。
    sid, sql = make_scenario(
        name="🟢11｜5/18 水鏡_未着手 107人 → 水鏡体験誘導",
        description="[自動発火] 3通 (0min→30min→翌日)。サミット熱量を活かして水鏡へ誘導。5次元解説 → 翌日チャレンジCTA",
        trigger_type="tag_added",
        trigger_tag_id=TAG_NOT_STARTED,
    )
    out.append(f"-- シナリオ 11: gw_5gen_post_summit (水鏡_未着手 107人 + 第5世代)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さん。

サミット、見ましたか？

あなたの先天螺旋——
算命学が「宿命」と呼び、ヴェーダが「ジャータカ」と記し、
神道が「産土」としたもの——
それを世界で初めて、NASA級精度で読み解く診断。

🔮 水鏡を体験する
→ [水鏡URL]"""))
    out.append(make_step(sid, 2, 30, """水鏡が読み解くのは、5つの次元です。

① 先天螺旋 — あなたが生まれ持ってきた力の型
② 後天系統 — 現世で磨かれていく方向性
③ 顕現叡智 — 表に出てくる知性の形
④ 五力プロファイル — 強み・潜在力・深さ・隠れた力・認知されやすい力
⑤ 統合ナラティブ — 全てが交差する、あなただけのストーリー

10分あれば、完走できます。

🔮 今すぐ体験 → [水鏡URL]"""))
    out.append(make_step(sid, 3, 1440, """{{name}} さん。

昨日、水鏡を体験してみましたか？

もし体験されたなら——
そのカードに書かれた言葉が、
あなたの分身AIの「核」になります。

その核を、3日間でAIに宿らせる体験を
チャレンジでやっています。

🚀 チャレンジ参加 → [チャレンジ申込URL]"""))
    out.append("")

    # ==================== シナリオ 12: gw_assessment_unbooked ====================
    # 個別審査未予約者へSoul-resonant再宣言。
    # チャレンジを見て気になっているのに、行動できていない人への一押し。
    # 「審査」フレーミングで、申し込む側ではなく選ばれる側として提示する。
    sid, sql = make_scenario(
        name="🔴12｜5/24 動的 → 審査未予約へ最後の誘導",
        description="[手動Enroll必須・動的] チャレンジ参加者のうち個別審査を予約していない人を抽出して手動登録。5/24。締切は5/25 23:59",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 12: gw_assessment_unbooked (個別審査未予約, 動的 manual)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """{{name}} さん。

これは「セールス」じゃなく「審査」です。

私とあなたの魂が、本当に合うか。
3ヶ月一緒に走れるか。
それを確かめる、15分。

→ [個別審査予約URL]

枠、残りわずかです。"""))
    out.append(make_step(sid, 2, 60, """もし迷っているなら——

チャレンジ3日間で伝えたかったこと、
一言で言うと。

「あなたの魂の核から育てた分身AIだけが、
 本当に人の心に届く」

それを証明する3ヶ月を、一緒にやりたいです。

→ [個別審査予約URL]

締め切り: 5/25 23:59"""))
    out.append("")

    # ==================== シナリオ 13: gw_ignition_downsell ====================
    # 個別審査不参加者へIGNITION ¥9,800ダウンセル。
    # 「タイミング」という言葉で責めずに、小さな入り口を用意する。
    # 分身AI講座の入り口として、最初の3日間体験を提供する。
    sid, sql = make_scenario(
        name="🔴13｜5/26 動的 → 審査不参加へIGNITION ¥9,800",
        description="[手動Enroll必須・動的] 個別審査に不参加だった人を抽出して手動登録。5/26。IGNITION申込URLと5/31締切を告知",
        trigger_type="manual",
        trigger_tag_id=None,
    )
    out.append(f"-- シナリオ 13: gw_ignition_downsell (IGNITION ダウンセル, 動的 manual)")
    out.append(sql)
    out.append(make_step(sid, 1, 0, """タイミング、というものがあります。

人類3000年の叡智体系が
1つのAIカテゴリーとして
動き出した世界の、たった三日間だけの入り口。

それが IGNITION です。

¥9,800。期限 5/31 23:59。

→ [IGNITION申込URL]"""))
    out.append(make_step(sid, 2, 60, """IGNITION の3日間でやること——

Day 1: あなたの魂の核を言語化する
Day 2: 核をAIに乗せる最初の設計をする
Day 3: 分身AIの「声」を作る

¥198,000 の本講座への道が、
ここから始まります。

迷っているなら、まず3日間。
それだけで、世界が変わります。

→ [IGNITION申込URL]
期限 5/31 23:59"""))
    out.append("")

    print("\n".join(out))


if __name__ == "__main__":
    main()
