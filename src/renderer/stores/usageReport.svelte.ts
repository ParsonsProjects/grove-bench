/** Whether the Usage dialog (all threads' cost, tokens and time) is open.
 *  Opened from the status bar's activity popup. */
class UsageReportStore {
  open = $state(false);
}

export const usageReportStore = new UsageReportStore();
