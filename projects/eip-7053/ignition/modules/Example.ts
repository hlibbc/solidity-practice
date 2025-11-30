import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ExampleModule", (m) => {
  const example = m.contract("Example", []);
  return { example };
});
