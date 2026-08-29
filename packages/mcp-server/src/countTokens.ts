import Anthropic from "@anthropic-ai/sdk";

const TOKEN_MODEL = "claude-sonnet-4-20250514";

/**
 * Count tokens with the Anthropic SDK `messages.countTokens` method.
 * Do not replace this with a character heuristic or tiktoken.
 */
export async function countResponseTokens(
  text: string,
  client: Pick<Anthropic, "messages"> = new Anthropic(),
): Promise<number> {
  const result = await client.messages.countTokens({
    model: TOKEN_MODEL,
    messages: [{ role: "user", content: text }],
  });
  return result.input_tokens;
}
