import { makeCoreModuleName } from '../util.js';

export const CoreUIModuleName = makeCoreModuleName('ui');

export default `module ${CoreUIModuleName}

entity Dashboard {
  id UUID @id @default(uuid()),
  name String,
  description String @optional,
  parameters Map @optional,
  layout String @default("grid"),
  width String @default("fixed"),
  archived Boolean @default(false)
}

entity DashboardTab {
  id UUID @id @default(uuid()),
  name String,
  position Int @default(0)
}

entity DashboardCard {
  id UUID @id @default(uuid()),
  row Int @default(0),
  col Int @default(0),
  sizeX Int @default(4),
  sizeY Int @default(3),
  parameterMappings Map @optional,
  visualizationSettings Map @optional
}

entity Card {
  id UUID @id @default(uuid()),
  title String,
  description String @optional,
  graphQuery String,
  tableQuery String,
  moduleName String,
  vizSettings Map @optional,
  viewMode String @default("table")
}

relationship DashboardTabs contains (Dashboard, DashboardTab)
relationship TabCards contains (DashboardTab, DashboardCard)
relationship CardContent contains (DashboardCard, Card)
`;
