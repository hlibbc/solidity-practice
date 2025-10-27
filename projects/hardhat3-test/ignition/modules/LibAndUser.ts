import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LibAndUserModule", (m) => {
    const mathLib = m.library("MathLib");
    const usesMath = m.contract("UsesMath", [], {
        libraries: { MathLib: mathLib },
    });
    return { mathLib, usesMath };
});
