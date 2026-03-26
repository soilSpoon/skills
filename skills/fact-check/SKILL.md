---
name: fact-check
description: Fact-check articles, newsletters, and written content by dispatching 6 parallel verification agents. Use this skill whenever the user asks to fact-check, verify claims, check accuracy of an article, validate sources, or review content for hallucinations. Triggers on phrases like "fact-check this", "verify this article", "check if this is accurate", "validate the claims", or any request to review written content for factual correctness. Also use when the user provides a URL or file and asks to check its accuracy.
---

# Fact-Check Skill

Verify factual claims in written content using 6 parallel verification agents with a tiered source credibility system.

## Input Handling

The user provides content in one of three ways:

1. **Direct text** after `/fact-check` - use the pasted content as-is
2. **File path** - read the file with the Read tool
3. **URL** - fetch the page content with WebFetch

Detect the input type automatically:
- Starts with `http://` or `https://` -> URL, fetch with WebFetch
- Contains a file extension (`.md`, `.html`, `.txt`, etc.) or starts with `/` or `~` -> file path, read with Read tool
- Otherwise -> treat as direct text content

If the input is ambiguous, ask the user to clarify.

**WebFetch fallback**: If WebFetch fails (paywall, bot protection, timeout), use this fallback chain:
1. Try WebSearch with the URL + key terms from the title to find cached/syndicated copies
2. Search for the article title to find other sources covering the same content
3. If the article can be partially reconstructed from search snippets, proceed with those claims but note in the report: "Article could not be fetched directly. Claims reconstructed from search results and surrounding coverage."
4. If no content can be recovered, tell the user and suggest they paste the text directly.

## Workflow

### Step 1: Extract Claims

Parse the input text and extract two categories:

**Explicit claims** - factual statements, statistics, quotes, dates, product names, release info
**Implicit assumptions** - unstated background facts the text relies on to make sense

For each claim, note:
- The exact quote from the text
- The claim type (statistic, date, quote, product info, causal, comparison, etc.)

### Step 1.5: Classify Risk

Assign a risk level to each claim:

| Risk | Criteria | Why it matters |
|------|----------|----------------|
| High | Numbers, dates, release info, direct quotes, pricing | Getting these wrong destroys credibility — readers notice and share corrections |
| Medium | Causality, comparisons, trend descriptions | Subtler errors that mislead without being obviously wrong |
| Low | General descriptions, subjective opinions, widely known facts | Low consequence if slightly off |

Present the extracted claims to the user before proceeding:
```
Found N claims (X high-risk, Y medium-risk, Z low-risk). Proceeding with verification...
```

### Step 2: Dispatch 6 Verification Agents

Launch all 6 agents in parallel using the Agent tool. Each agent gets:
- The full original text
- The extracted claims list with risk levels
- Any source URLs found in the text

For each agent, read the corresponding prompt file and include it in the agent's instructions:

| Agent | Prompt file | Purpose |
|-------|-------------|---------|
| Source Verify | `agents/source-verify.md` | Compare claims against their cited sources |
| Number Check | `agents/number-check.md` | Verify dates, numbers, proper nouns |
| Freshness Check | `agents/freshness-check.md` | Check if time-sensitive info is current |
| Context Check | `agents/context-check.md` | Detect distortion, exaggeration, false causation |
| Link Check | `agents/link-check.md` | Validate all URLs in the text |
| Assumption Check | `agents/assumption-check.md` | Surface and verify unstated assumptions |

Read each agent's prompt file from the skill directory before dispatching. The skill directory path is: the directory containing this SKILL.md file.

**Important**: Use `subagent_type: "general-purpose"` for each agent. Launch all 6 in a single message to maximize parallelism.

### Step 3: Cross-Reference Results

After all agents return:

1. **Merge findings** - combine results from all 6 agents per claim
2. **Detect conflicts** - if agents disagree on a claim, note the disagreement and include a "Conflicts" section in the report showing which agents disagree and why
3. **Check internal consistency** - scan for contradictions within the text itself (e.g., "4 options" but only 3 listed, numbers that don't add up, dates that conflict with each other). These are errors that don't require external verification.
4. **Assign source tiers** - rate the best source found for each claim:

| Tier | Type | Examples | Trust Level |
|------|------|----------|-------------|
| Tier 1 | Direct source | Official blogs, academic papers, press releases, government docs | High |
| Tier 2 | Trusted media | Major tech/news outlets (Reuters, AP, NYT, Verge, etc.), official reports | Medium-High |
| Tier 3 | Secondary | Personal blogs, community posts, social media | Low |
| Tier 4 | Unverified | No source found, rumors, unofficial leaks | Very Low |

5. **Auto-escalate low-tier claims** - for any claim where only Tier 3-4 sources were found, automatically search for higher-tier sources using WebSearch. If a Tier 1-2 source is found, update the verdict. If not, mark with a warning. Show escalation attempts in the report:
   ```
   ### Tier Escalation
   - Claim #3: Tier 3 -> searched for Tier 1-2 -> found [official source] -> upgraded to Tier 1
   - Claim #7: Tier 4 -> searched for Tier 1-2 -> no higher source found -> remains Tier 4 ⚠️
   ```

### Step 4: Generate Verdict

Assign a verdict to each claim:

- **Confirmed** - verified against Tier 1-2 sources
- **Needs Revision** - partially correct, or only low-confidence sources available
- **Error** - contradicted by reliable sources
- **Unverifiable** - cannot confirm or deny with available sources

### Step 5: Output Report

Present the report in this order — summary first, then details. The reader should get the verdict in 10 seconds, then drill into details if they want.

```
## Fact-Check Report

### Summary
- Claims checked: N (High: A, Medium: B, Low: C)
- Confirmed: X / Error: Y / Needs Revision: Z / Unverifiable: W

### Verdicts

| # | Claim | Risk | Verdict | Source Tier | Details |
|---|-------|------|---------|-------------|---------|
| 1 | "..." | High | Confirmed | Tier 1 | Verified via official blog post |
| 2 | "..." | High | Error | - | Original says X, but official source says Y |
| 3 | "..." | Med  | Needs Revision | Tier 3 | Only blog sources found, no official confirmation |

### Conflicts (if any)
- Claim #5: Source Verify says "match", Freshness Check says "outdated" -> resolved as "Needs Revision" because...

### Tier Escalation (if any)
- Claim #3: Tier 3 -> Tier 1 (found official source)
```

**Keep it concise.** Do NOT append per-agent detailed reports after the main report. The agent-level detail is useful for debugging the skill, not for the user. If the user asks for details on a specific claim, provide them on request.

### Step 6: Suggest Fixes

For claims marked **Error** or **Needs Revision**, provide diff-style corrections:

```
### Suggested Fixes

1. [Error] Line 12:
   - "OpenAI는 2026년 말까지 AGI를 달성할 것이라고 발표했다"
   + (삭제 권장 — 공식 발표 확인 불가, Tier 4 소스만 존재)

2. [Needs Revision] Line 28:
   - "2025년 봄 출시 예정"
   + "2025년 봄 출시 예정이었으나 2026년 9월로 세 차례 연기됨"
     Source: [공식 블로그 링크]
```

## Key Principles

- **Conservative judgment**: when in doubt, mark as "Needs Revision" rather than "Confirmed". It is far better to flag something that turns out to be correct than to miss something that is wrong.
- **"I don't know" is valuable**: "Unverifiable" is a legitimate and useful verdict. The absence of confirmation is information worth reporting.
- **Source quality over quantity**: one Tier 1 source outweighs ten Tier 3 sources.
- **Context matters**: a claim can be technically accurate but misleading in context. The context-check agent catches this.
