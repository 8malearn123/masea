export interface MonthlyPoint {
  month: string;
  contracts: number;
  revenue: number;
}

export interface BranchPoint {
  branch: string;
  contracts: number;
  revenue: number;
}

export interface ServiceSlice {
  name: string;
  value: number;
}

export interface ReportsData {
  monthly: MonthlyPoint[];
  branches: BranchPoint[];
  services: ServiceSlice[];
}
