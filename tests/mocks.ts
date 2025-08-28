// MockAggregator.ts
import { G1Point, G2Point } from "eigensdk/crypto/bls/attestation";
import { Aggregator } from "../aggregator";

export interface MockOperatorInfo {
    id: string;
    operatorId: string;
    socket: string;
    stake: number;
    publicKeyG1: G1Point;
    publicKeyG2: G2Point;
}

export class MockAggregator extends Aggregator {
    operators: Record<string, MockOperatorInfo>;

    constructor(config: any) {
        super(config);

        this.operators = {
            "0x4e9d5e7adb0358769acf7bff73fc3a1b9deaf75fe80e8bff76f74368321b190d": {
                id: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                operatorId:
                    "0x4e9d5e7adb0358769acf7bff73fc3a1b9deaf75fe80e8bff76f74368321b190d",
                socket: "operator-socket",
                stake: 1000.0,
                publicKeyG1: new G1Point(
                    6215226345347598808943795851523791229876229208576129369583737851087597593861n,
                    9766767189964457771940479283704489345454638402069882955663797906544898488518n
                ),
                publicKeyG2: new G2Point(
                    4995568137772915223840138616169797328411623133468774131001700833369568948651n,
                    17933544174729634020071736015620965048444565409759239615835635910795712634412n,
                    16990542675077220341012246256459868366846098673053572406506919620979089149247n,
                    21224460936658816586314920177677529580663325026565513718514980550284520357390n,
                ),
            },
            "0x57bd7cf8f5eab36aa605745552f6372bc3e3875396ca3612c94e26091d7f27aa": {
                id: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                operatorId:
                    "0x57bd7cf8f5eab36aa605745552f6372bc3e3875396ca3612c94e26091d7f27aa",
                socket: "operator-socket",
                stake: 1000.0,
                publicKeyG1: new G1Point(
                    12629806069277722946425437578301737877317365768892980531608702124790565977658n,
                    3156427026067390808005202991748035868490492901784157391608347920528407745037n
                ),
                publicKeyG2: new G2Point(
                    19555752462510754952069494365548426850835176013505855141008239740485949316520n,
                    697075605364145993488769260429490464285761533927005509067549857735990116804n,
                    12956849738211212154674853372852899050238641046962342158644986265133124922709n,
                    1632294767555776735123319193573148448888420040868023776957938183117085635025n,
                ),
            },
            "0xc4c210300e28ab4ba70b7fbb0efa557d2a2a5f1fbfa6f856e4cf3e9d766a21dc": {
                id: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
                operatorId:
                    "0xc4c210300e28ab4ba70b7fbb0efa557d2a2a5f1fbfa6f856e4cf3e9d766a21dc",
                socket: "operator-socket",
                stake: 1000.0,
                publicKeyG1: new G1Point(
                    643552363890320897587044283125191574906281609959531590546948318138132520777n,
                    7028377728703212953187883551402495866059211864756496641401904395458852281995n
                ),
                publicKeyG2: new G2Point(
                    15669747281918965782125375489377843702338327900115142954223823046525120542933n,
                    10049360286681290772545787829932277430329130488480401390150843123809685996135n,
                    14982008408420160629923179444218881558075572058100484023255790835506797851583n,
                    4979648979879607838890666154119282514313691814432950078096789133613246212107n,
                ),
            },
        };
    }

    async operatorsInfo(block: number): Promise<Record<string, MockOperatorInfo>> {
        return Promise.resolve(this.operators);
    }
}
