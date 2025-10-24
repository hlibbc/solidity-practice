import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MyTokenModule", (m) => {
  const name = m.getParameter("NAME", "MyToken");
  const symbol = m.getParameter("SYMBOL", "MTK");
  const deployer = m.getAccount(0);
  const myToken = m.contract("MyToken", [name, symbol], { from: deployer });
  return { myToken };
});


