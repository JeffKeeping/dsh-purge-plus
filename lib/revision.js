/**
 * 状态修订号（CAS）。
 *
 * 场景：设置页每 5 秒轮询一次 `/dsh-purge/status`。两次轮询之间用户可能点了
 * 「应用」，另一个窗口（Web + 桌面同时开着）也可能点了。旧代码里 apply / revert
 * 是无条件执行的——后到的那个会覆盖先到的结果，而界面以为自己看到的是最新状态。
 *
 * 这里给状态机一个单调递增的 `rev`：读状态时带出、写动作时带上。服务端比对
 * 不一致就返回 409 和当前 rev，由调用方决定重新拉一次还是放弃，而不是盲写。
 *
 * 不持久化：rev 只描述「本进程内的状态演进」，重启后归零是正确语义——
 * 重启本来就会让所有客户端重新拉状态。
 */

let rev = 0;
let lastAction = "";
let lastActionAt = 0;

export function currentRev() {
  return rev;
}

export function bumpRev(action) {
  rev += 1;
  lastAction = String(action || "");
  lastActionAt = Date.now();
  return rev;
}

export function lastActionInfo() {
  return { action: lastAction, at: lastActionAt, rev };
}

/**
 * 校验调用方期望的修订号。
 *
 * - 不传（undefined / null / ""）：放行，并把当前 rev 一起返回，兼容旧客户端。
 * - 传了且相等：放行。
 * - 传了但不相等：拒绝，附上当前 rev 与最近一次动作，便于界面提示。
 *
 * 解析失败按「没传」处理：宁可放行也不要把一个手误的参数变成硬错误，
 * 真正的保护来自相等判断本身，而不是参数格式校验。
 */
export function checkRev(expected) {
  if (expected === undefined || expected === null || expected === "") {
    return { ok: true, rev, expected: null };
  }
  const wanted = Number(expected);
  if (!Number.isFinite(wanted)) return { ok: true, rev, expected: null };
  if (wanted === rev) return { ok: true, rev, expected: wanted };
  return {
    ok: false,
    rev,
    expected: wanted,
    stale: wanted < rev,
    last: lastActionInfo(),
    error: wanted < rev
      ? `stale revision: client had rev ${wanted}, current is ${rev}`
      : `unknown revision: client had rev ${wanted}, current is ${rev}`,
  };
}

/** 测试用：把状态复位。生产代码不要调用。 */
export function resetRevForTests() {
  rev = 0;
  lastAction = "";
  lastActionAt = 0;
}
