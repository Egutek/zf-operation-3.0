# Firebase V3 setup

1. Vytvořte nový Firebase projekt pouze pro ZF Operativa V3.
2. Zapněte Anonymous Authentication a Firestore Standard.
3. Nasaďte `firebase.json` a pravidla z tohoto repozitáře.
4. Do Vercel Preview nastavte hodnoty z `.env.example`.
5. V Cloud Storage nastavte lifecycle pravidlo: prefix `zf-operativa-v3/`, Delete, Age 7 dní.
6. Nepropojujte tento projekt s původní Firebase/Netlify ani Sites/D1 aplikací.
