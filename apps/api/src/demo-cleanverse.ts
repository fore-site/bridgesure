import type { UpdateStatusData, UpdateStatusRequest } from '@bridgesure/cleanverse';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';

/**
 * Scripted demo client used when BRIDGESURE_CLEANVERSE_MODE=demo (the default).
 *
 * Both participants start fully compliant (A-Pass code 4, validator valid) so
 * the first release clears. The demo freeze action routes through the real
 * server boundary (/update_status, status "2" = frozen) and this client
 * reflects it: the frozen participant's A-Pass drops to ineligible (code 2)
 * and their validator result flips to invalid — so the next release attempt
 * fails closed with a reason code and the escrow balance does not move.
 */
export class DemoCleanverseClient extends MockCleanverseClient {
  constructor(importer: string, exporter: string) {
    super();
    this.setApass(importer.toLowerCase(), 4);
    this.setValidator(importer.toLowerCase(), 'valid');
    this.setApass(exporter.toLowerCase(), 4);
    this.setValidator(exporter.toLowerCase(), 'valid');
  }

  override async updateStatus(req: UpdateStatusRequest): Promise<UpdateStatusData> {
    // A freeze is a credential state change, not a one-off mock flag: persist
    // it in the script so every later /verify_apass and /validator/verify call
    // for that participant reports the invalidated state.
    if (req.status === '2') {
      const address = req.wallet.address.toLowerCase();
      this.setApass(address, 2);
      this.setValidator(address, 'invalid');
    }
    return super.updateStatus(req);
  }
}
