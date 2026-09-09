import type { HarnessReply } from "@executioncontrolprotocol/types"
import type { EcpFormatOptions } from "@executioncontrolprotocol/types"
import type { EqlFormatOptions } from "../schemas.js"
import { EqlWriter, formatLiteral } from "./writer.js"

export function encodeReplyToEql(
  reply: HarnessReply,
  options?: EcpFormatOptions & EqlFormatOptions,
  includeHeader = true
): string {
  const writer = new EqlWriter(options)
  if (includeHeader) {
    writer.writeln("ECP @executioncontrolprotocol.harness.reply 1.0")
  }
  writer.writeln("REPLY")
  writer.writeln(`ANSWER ${formatLiteral(reply.answer, writer.quote)}`, 1)
  for (const c of reply.citations ?? []) {
    const idPart = c.id ? ` ${c.id}` : ""
    const detailPart = c.detail ? ` ${formatLiteral(c.detail, writer.quote)}` : ""
    writer.writeln(`CITATION ${c.kind}${idPart}${detailPart}`, 1)
  }
  if (reply.suggestedAction) {
    writer.writeln(`ACTION ${reply.suggestedAction}`, 1)
  }
  return writer.toString()
}
