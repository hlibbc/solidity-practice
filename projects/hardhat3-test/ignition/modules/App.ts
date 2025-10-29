import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import MyTokenModule from "./MyToken.js";
import LibAndUserModule from "./LibAndUser.js";

export default buildModule("AppModule", (m) => {
    const { myToken } = m.useModule(MyTokenModule);
    const { usesMath } = m.useModule(LibAndUserModule);
    return { myToken, usesMath };
});
