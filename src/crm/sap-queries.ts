// Read-only queries against each shop's SAP company DB (standard SAP B1 tables + the
// shop's U_ fields). These replace stored procs that only existed in Tanzania's DB, so
// every shop works with its databases exactly as they are - nothing is deployed to them.
// Column lists/aliases are copied verbatim from the original procs so API responses
// keep the same shape.

export const ADDRESS_MASTER = `
SELECT CardCode [custcode], street [address1], [Block] [address2], Address2+Address3 [address3], City [city], T0.State [statecode],
  ZipCode [pincode], Country [countrycode], '' [geolocation1], '' [geolocation2], GETDATE() [createdateTime], GETDATE() [updatedDatetime],
  '1' [createdUserID], '1' [updateduserid], '' [lastupdateIp], AdresType [addresstype]
FROM CRD1 T0
WHERE CardCode IN (
  SELECT CardCode FROM OCRD T0 INNER JOIN OCRG T1 ON T0.GroupCode = T1.GroupCode
  WHERE CardType = 'c' AND validFor = 'y')`;

export const CUSTOMER_MASTER = `
SELECT CardCode [customerCode], CardName [customername], '' [premiumid], T1.GroupName [customertype],
  '' [taxno], '' [createdbybranch], T0.Balance [balance], '0' [points], GETDATE() [snapdatetime],
  T0.Phone1 [phoneno1], T0.Phone2 [phoneno2], T0.E_Mail [emalid], GETDATE() [createdateTime], GETDATE() [updatedDatetime],
  '1' [createdUserID], '1' [updateduserid], '' [lastupdateIp], ISNULL(ECVatGroup, 'O1') TaxCode, ISNULL(U_CASHCUST, 'No') AS U_CASHCUST
FROM OCRD T0
INNER JOIN OCRG T1 ON T0.GroupCode = T1.GroupCode
WHERE CardType = 'c' AND validFor = 'y'
ORDER BY CardName ASC`;

// ponytail: price list 14 for warehouse DOCFG is a Tanzania rule carried over from the
// original proc; move it to per-shop config if another shop needs its own mapping.
// Zambia's SAP companies have no OITM.U_BRAND field, so the brand is only added where it exists.
export const ITEM_MASTER = (withBrand: boolean) => `
SELECT Y.itemname, X.[itemcode],
  X.WhsCode,
  X.[serialbatch],
  CONVERT(int, X.[quantity]) [quantity],
  X.Quantity [maximumQty], '0' [minimumQty], '10' [displayQty],
  Y.ItemCode+','+Y.ItemName+','+Y.FrgnName${withBrand ? "+','+Y.U_BRAND" : ''} [searchString],
  '' category, CASE WHEN Y.U_Pack_Size_UOM = 'L' THEN ISNULL(U_Pack_Size, 0) ELSE 0 END [liter],
  '' category, CASE WHEN Y.U_Pack_Size_UOM = 'KG' THEN ISNULL(U_Pack_Size, 0) ELSE 0 END [weight],
  '' [hsnsac], Y.frozenFor [isActive], 'FALSE' isfreeby, 'TRUE' [isinventory], 'FALSE' [issellpricebyscrbat],
  Y.ItemCode+','+Y.ItemName+','+Y.FrgnName${withBrand ? "+','+Y.U_BRAND" : ''} [itemnamelong],
  Y.ItemName [itemnameshort],
  Y.ItemCode [skucode],
  '' [subcategory],
  Z.Price [sellprice],
  Z.Price [mrpprice], Z.Price [specialprice], '50' [maxdiscount], T6.Rate [taxrate], GETDATE() [snapdatetime],
  GETDATE() [purchasedate], GETDATE() [createdateTime], GETDATE() [updatedDatetime],
  '1' [createdUserID], '1' [updateduserid], '' [lastupdateIp], U_Pack_Size, U_TINS_PER_BOX,
  CASE WHEN U_Manufacturer <> '  ' THEN U_Specific_Gravity ELSE 0 END U_Specific_Gravity,
  U_Pack_Size_uom
FROM (
  SELECT T0.[ItemCode], T0.[Quantity], T0.[WhsCode], T1.[DistNumber] [serialbatch]
  FROM OBTQ T0
  INNER JOIN OBTN T1 ON T0.MdAbsEntry = T1.AbsEntry AND T0.ItemCode = T1.ItemCode
  WHERE T0.[WhsCode] = @whscode AND T0.Quantity > 0
) X
JOIN OITM Y ON X.ItemCode = Y.ItemCode
INNER JOIN ITM1 Z ON Z.ItemCode = Y.ItemCode AND Z.PriceList = CASE WHEN @whscode = 'DOCFG' THEN 14 ELSE 1 END
LEFT JOIN OVTG T6 ON Y.VatGroupPu = T6.Code
WHERE [quantity] > 0
ORDER BY X.ItemCode, WhsCode`;

export const FILTERED_ITEMS_IN_STOCK = `
SELECT b.WhsCode, a.ItemCode, a.ItemName, a.OnHand AS QuantityOnStock, a.U_Pack_Size
FROM OITM a
INNER JOIN OITW b ON a.ItemCode = b.ItemCode
WHERE (@Search IS NULL OR @Search = '' OR a.ItemCode LIKE '%' + @Search + '%' OR a.ItemName LIKE '%' + @Search + '%')
  AND U_Pack_Size LIKE '%.%'
  AND ItemName NOT LIKE '%bulk%'
  AND (@MainGroup IS NULL OR @MainGroup = '' OR U_Prd_MainGrp = @MainGroup)
  AND (@SubGroup IS NULL OR @SubGroup = '' OR U_Prd_SubGrp = @SubGroup)
  AND validFor = 'Y' AND b.WhsCode = @WhsCode`;

export const ITEMS = `
SELECT T1.ItemCode, T1.ItemName, T1.SalUnitMsr, T1.U_Pack_Size, T1.U_Tins_Per_Box, T1.U_Prd_MainGrp, T1.U_Prd_SubGrp, T2.Price
FROM OITM T1
LEFT JOIN ITM1 T2 ON T1.ItemCode = T2.ItemCode AND T2.PriceList = 1
WHERE T1.ValidFor = 'Y'
  AND T1.FrozenFor = 'N'
  AND T1.QryGroup1 = 'Y'
  AND (@Search IS NULL OR T1.ItemCode LIKE '%' + @Search + '%' OR T1.ItemName LIKE '%' + @Search + '%')
  AND (@MainGrp IS NULL OR T1.U_Prd_MainGrp = @MainGrp)
  AND (@SubGrp IS NULL OR T1.U_Prd_SubGrp = @SubGrp)
  AND (@PackSize IS NULL OR T1.U_Pack_Size LIKE '%' + @PackSize + '%')
ORDER BY T1.ItemCode`;

export const PLAN_DETAILS = `
SELECT T0.ClgCode, T0.CardCode, T1.CardName, T0.Details, T0.U_Status, T0.U_PlanDate, T0.U_PlanTime,
  T0.U_Latitude, T0.U_Longitude, T0.CntctSbjct
FROM OCLG T0
INNER JOIN OCRD T1 ON T0.CardCode = T1.CardCode
WHERE MONTH(T0.U_PlanDate) = MONTH(COALESCE(CAST(@selecteddate AS date), CAST(GETDATE() AS date)))
  AND YEAR(T0.U_PlanDate) = YEAR(COALESCE(CAST(@selecteddate AS date), CAST(GETDATE() AS date)))
  AND T0.SlpCode = @slpcode`;

// Header + lines: each returns two recordsets, like the procs they replace.
const DOC_LINES = (table: string, extra = '') => `
SELECT T1.DocEntry, T1.LineNum, T1.ItemCode, T1.Dscription AS ItemDescription, T1.WhsCode AS Warehouse, T1.Quantity,
  T1.Price AS UnitPrice, T1.LineTotal AS ValueBeforeTax, T1.VatSum AS LineTax,${extra} (T1.LineTotal + T1.VatSum) AS LineTotalWithTax
FROM ${table} T1
WHERE T1.DocEntry = @docentry`;

const DOC_HEADER = (table: string, extra = '') => `
SELECT T0.DocEntry, T0.DocNum AS DocumentNo, T0.Comments AS Remarks, T0.CardCode AS BPCode, T0.CardName AS BPName,
  T0.DocDate AS DocumentDate, T0.VatSum AS TaxTotal, T0.DocTotal AS DocumentTotal,
  T0.U_Order_Type AS OrderType, T0.U_GP_Approval AS GPApproval, T0.GroupNum AS PaymentTermsCode,
  T3.PymntGroup AS PaymentTermsName, T0.PeyMethod AS PaymentMeans, T0.Address AS BillToAddress, T0.Address2 AS ShipToAddress${extra}
FROM ${table} T0
LEFT JOIN OCTG T3 ON T0.GroupNum = T3.GroupNum
WHERE T0.DocEntry = @docentry;`;

export const QUOTATION_DETAILS = `
SELECT T0.DocEntry, T0.DocNum AS DocumentNo, T0.Comments AS Remarks, T0.CardCode AS BPCode, T0.CardName AS BPName,
  T0.DocDate AS DocumentDate, T0.VatSum AS TaxTotal, T0.DocTotal AS DocumentTotal, T0.NumAtCard AS CustomerRef
FROM OQUT T0
WHERE T0.DocEntry = @docentry;
${DOC_LINES('QUT1', ' T1.OpenQty AS OpenQty,')}`;

export const ORDER_DETAILS = `${DOC_HEADER('ORDR', ',\n  T0.NumAtCard AS CustomerRef')}
${DOC_LINES('RDR1')}`;

export const DRAFT_DETAILS = `${DOC_HEADER('ODRF')}
${DOC_LINES('DRF1')}`;

export const QUOTATION_FULL = `
SELECT T0.DocEntry, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T0.Address, T0.DocTotal, T0.Comments,
  T0.SlpCode AS SalesPersonCode, T0.ShipToCode, T0.U_DeviceTransID
FROM OQUT T0 WITH (NOLOCK)
WHERE T0.DocEntry = @docentry;
SELECT T1.LineNum, T1.ItemCode, T1.Dscription AS ItemDescription, T1.Quantity, T1.Price, T1.DiscPrcnt AS DiscountPercent,
  T1.LineTotal, T1.VatSum AS TaxTotal
FROM QUT1 T1 WITH (NOLOCK)
WHERE T1.DocEntry = @docentry
ORDER BY T1.LineNum`;

// Was the GetSalesPersonDetails proc (Tanzania only); used by the dashboard through Sellerkit.
export const SALES_PERSON_DETAILS = `
SELECT
  (SELECT COUNT(*) FROM ORDR WHERE SlpCode = @SlpCode AND DocStatus = 'C') AS OrderCount,
  (SELECT COUNT(*) FROM OCRD WHERE SlpCode = @SlpCode) AS CustomerCount,
  (SELECT COUNT(*) FROM OCLG WHERE SlpCode = @SlpCode AND U_COLatitude IS NOT NULL) AS VisitCount,
  (SELECT Mobil FROM OSLP WHERE SlpCode = @SlpCode) AS MobileNo`;

// Was the BZ_CRM_SalesType proc (valid values of the customer field U_SaleType). The proc
// picked the field by number (FieldID = 5), which is a different field in Zambia's company;
// looked up by name here so every shop returns sale types, or nothing if it has no such field.
export const SALES_TYPES = `
SELECT v.FldValue, v.Descr
FROM UFD1 v
INNER JOIN CUFD f ON f.TableID = v.TableID AND f.FieldID = v.FieldID
WHERE f.TableID = 'OCRD' AND f.AliasID = 'SaleType'
ORDER BY v.IndexID`;

// A customer's tax code (the customer's tax group, ECVatGroup) - the same field and 'O1' default CustomerMaster reports
// as TaxCode. Used to add TaxCode to each shop's own BZ_CRM_GET_CUST_SLPCODE rows, whose columns differ per shop.
export const CUSTOMER_TAX_CODES = `
SELECT CardCode, COALESCE(NULLIF(LTRIM(RTRIM(ECVatGroup)), ''), 'O1') AS TaxCode
FROM OCRD
WHERE CardType = 'C'`;

// Sales dashboard for one salesperson. Recordset 1: totals per period - Day is the calendar date @day picked in the UI;
// Week (Monday-Sunday), Month and Year are always the current ones, so the date filter does not move them. Recordset 2:
// quantity sold per product within each period (the service keeps each period's top 4 and folds the rest into "Others").
// Own, non-cancelled sales orders only; the amount is DocTotal (tax included), the same as the TodaySoldAmount login claim.
export const SALES_SUMMARY = `
DECLARE @d date = @day;
DECLARE @t date = CAST(GETDATE() AS date);
DECLARE @wk date = DATEADD(day, -(DATEDIFF(day, '19000101', @t) % 7), @t);
DECLARE @p TABLE (Period varchar(5), FromDate date, ToDate date);
INSERT @p VALUES ('Day', @d, @d),
  ('Week', @wk, DATEADD(day, 6, @wk)),
  ('Month', DATEFROMPARTS(YEAR(@t), MONTH(@t), 1), EOMONTH(@t)),
  ('Year', DATEFROMPARTS(YEAR(@t), 1, 1), DATEFROMPARTS(YEAR(@t), 12, 31));
SELECT p.Period, COUNT(o.DocEntry) AS Orders, ISNULL(SUM(o.DocTotal), 0) AS Amount,
  ISNULL(SUM(q.Quantity), 0) AS Quantity
FROM @p p
LEFT JOIN ORDR o ON o.SlpCode = @slpcode AND o.CANCELED = 'N' AND o.DocDate BETWEEN p.FromDate AND p.ToDate
OUTER APPLY (SELECT SUM(l.Quantity) AS Quantity FROM RDR1 l WHERE l.DocEntry = o.DocEntry) q
GROUP BY p.Period;
SELECT p.Period, l.ItemCode, MAX(l.Dscription) AS ItemName, SUM(l.Quantity) AS Quantity
FROM @p p
INNER JOIN ORDR o ON o.SlpCode = @slpcode AND o.CANCELED = 'N' AND o.DocDate BETWEEN p.FromDate AND p.ToDate
INNER JOIN RDR1 l ON l.DocEntry = o.DocEntry
GROUP BY p.Period, l.ItemCode
ORDER BY p.Period, SUM(l.Quantity) DESC, l.ItemCode`;
