-- #1134, owner decision 07.11.2026 («как можно магазины фабрик вообще привязать к пиццериям?!»): retire the
-- chains discovered from branded shops of confectionery/chocolate manufacturers in every country but BY
-- (BY is 20261107120000). Collector rule: scripts/market/adapters/overture.ts (isManufacturerShop) and
-- <country>.manufacturerShops. Ice-cream/frozen-yogurt parlours and bakeries are NOT in the list.
-- Snapshot read from prod 2026-11-07: 14 chains, all uncurated, no references.
-- All business fields are CAS-checked; only automatic freshness timestamps are excluded.
-- A chain whose state changed since the snapshot (curated, referenced, edited) is skipped with a warning,
-- never deleted; the rest still go. Nothing else (other chains, countries, curated data) is changed.
-- Idempotent: an absent chain is a no-op.
do $migration$
declare
  targets constant jsonb := $targets${
  "AM/grand-candy": {
    "chain": "a465e32cd357b2cd427f847b59976b99",
    "id": "8194a335-898b-4dca-89cc-e7847e000cc8",
    "points": {
      "1e8439b4-a61c-48b3-b768-3c350ec740e9": "c97bf3033a61244633dff0244f99628a",
      "3a500fe2-c0c5-477c-b6d1-b0f18cd641c8": "e0a0bdd00a8cb83c48cc3e459b9d2185",
      "3b70727f-90be-4e4b-a9b5-4bfa13d1e83a": "5809db4d98925bc7953429c9ff51836a",
      "6ee003c0-8c5f-484c-9c09-9d0222623057": "b2db651ef56c8892d84ceb9658305238",
      "8d2c8862-073a-489a-8d92-175fab6420d5": "f237668664b13d52ccbf9d468d1fb0d7",
      "b44e76d9-0c18-43d0-890b-d7dccb76327a": "8d2ebeb5be3c5c174dddc119264aee7e",
      "d0d00e82-2785-40b9-8538-13bd39b7bf2e": "960c8d52c3da8afda3e9e4bc7a803648",
      "d8cc30a0-5654-4282-9550-80851a795a1d": "19b2e951623ce49c1cf3c35f97c623d3",
      "e782035e-1512-432b-92e3-aec2d97790ca": "853b60d2954f34f67d0ff0623a85813f",
      "ea147b2c-c98b-440e-a684-762a9009a23e": "61c214506197d76b891c28f81413f6b7"
    }
  },
  "AM/marush-sweets-boutique": {
    "chain": "30a085b69f192200b28b4f269cd653b8",
    "id": "1ccca901-6e06-4995-891a-0bc063397dc2",
    "points": {
      "644457cd-4a32-475e-9bb2-94bc870a3ecb": "adf488b67c5581fc76b0a5e9bb84fcbe",
      "70a1ea6b-3e50-4c64-8010-eea9549d5396": "f4fd8529dcb7d82d7a1061da47416a5d",
      "c5f755c2-216c-4704-a5d8-87077df1395f": "d778f102178bc46317c591b7436fdce2",
      "ecd8d165-ac47-4415-9d67-948f918052c4": "8f455717bbb4ea19a817189dab602997"
    }
  },
  "AZ/ramzioglu-paxlava": {
    "chain": "66f6457114cf3944c0c7ce3c4bc41c72",
    "id": "f2c8e0fe-ded3-4745-80f5-8b4bc2a1f218",
    "points": {
      "27e7ce01-3a80-4d36-bf99-6bed842c5c99": "b31060521f9114e5f02ac5148ac95e04",
      "5e6fa898-d404-443e-9323-41e608dc5d82": "65051d4a3d986b1eeaa85371d362cfb5",
      "a3f52a3f-a6b9-447c-8377-c67b74324e54": "18c4299c1ea8b275b61d91f647e80fc8",
      "a55c7e8f-2973-499d-8212-bea981f1138b": "e79faed8100e58820066ff09afc48df7",
      "ccfbf31a-39a3-4540-ad9b-f674cfa6f8c9": "2113db90e9f2f9fdf3b8e39c416d6fe2",
      "e6b45d19-c8ee-4fb7-928f-b954fdafc951": "89c8829b84cb1dd0a52a229682ab7d55"
    }
  },
  "AZ/ruggi-sweets": {
    "chain": "ad89ff2dfcff7558f8db8ca2ce48c750",
    "id": "a21f8b5a-ea22-4d13-bd77-501cebe038d0",
    "points": {
      "073a7ba6-8507-4e26-a396-b12aa217010e": "d47aa3919fc97a65e0d7cf78ce33e55f",
      "821b26e1-2b70-45c7-b956-d1961060ad71": "7d096eabc450fcae7dd044210b522f77",
      "87909542-3251-4b5d-a7f4-6ebb21a0667e": "ef464f960087f613d5fe4f48c32db994",
      "c8c2b84b-23ff-45d4-9c2d-cdb8f8be0220": "de458d2a1aedd3ea3a2c4b79d886f5d5"
    }
  },
  "CY/leonidas": {
    "chain": "8007abd1479e4e81f9f6d339cea75452",
    "id": "01c1b519-a2f2-46d6-9be0-6638c7e46ce2",
    "points": {
      "13b1cb74-a932-48b9-ad74-046026dfba48": "01b91dd84dccfe98b9fe9ec5861bd733",
      "3881a7f2-1ea8-4a99-b9af-49bdd2408f8b": "7d5ed793b73c3046ecc99f0b45833ea6",
      "4a6e50ec-7b79-447c-ae73-b5b4a374567e": "47eade9c71b96965e4420e4cd9b60149",
      "5e2efadb-6914-47b1-a5a4-bc1207daf240": "8bf326af98a214154de4115ef97aa5bc",
      "6d462a92-55a1-4ee3-a37c-7533eb934a6c": "8a2a0d691b75a15746e34c380513baa6",
      "9e2962c6-853c-475f-a522-df219d5edd03": "4199a8abfe1deb9336c1a3a38d9abab4"
    }
  },
  "CY/pralina-confectioneries": {
    "chain": "302da62c94f8749072e6c9f1d2739259",
    "id": "474d1a07-d220-448f-8a23-f3f6144eb34e",
    "points": {
      "5fbf4512-c909-4469-a802-b6e17b931ad5": "db40a822995051c81d22ef5dcdf546aa",
      "89c842a7-afb2-46ad-beef-05028d91868f": "78e5fc7054e6faf95436ecba4195bbe1",
      "aebeb9fa-c40b-44c6-8745-20ce44a67cf0": "44bfa42f7645e48deb80ae4b9c7371e6",
      "e6f457bf-c2ce-401e-91ba-f1cbfffaa8d8": "dc2ff57213537610940bb3895367dcd5"
    }
  },
  "HU/lindt": {
    "chain": "751bc984644175dfbfcefbc8f4c0a2cb",
    "id": "4e394c13-6d6d-4a9a-acc7-47ccdb0d0c6c",
    "points": {
      "01f6a43a-cd2e-4777-8f3c-9abf1daf80f3": "aabbcdf77f9e4146a33a978170df49e8",
      "1a567235-c34f-4f21-97b7-64cfa8150f96": "7b1bf1136eedf3550e05d89534ad4b3e",
      "1bf441d3-efc2-435e-acf6-7b1c060cd8d1": "503e2961c172390604fa6f7f4381037b",
      "48122b94-67a4-42a5-a624-38387b00d3c6": "f0ca3debed39e99c249300222e05ee1d",
      "5eb072f6-037a-45c8-98cb-c8521713f2e0": "9c3e5b240fe3df8b083eb2a92df9a290",
      "70f47acc-5057-4259-861b-dca5189db171": "7af83b75d0a297fe4aa84a24fa19048e",
      "7e4f70ec-68b2-48f5-84e8-fba0dc323b69": "c99351337dc43592be09c26801f388ac",
      "7ea6e966-825d-4bc2-b564-b464ec8dcc2e": "5d0c762b4d018c489271230ff6798866",
      "83c2af2b-3366-4666-a0dd-4bec245ff7d1": "9b153c229faf1028d40183263b8d01ac",
      "e3923709-4445-4034-a697-7eb2f94d0331": "b8420681db0d7fc4d94cbf033c703492"
    }
  },
  "LT/aj-sokoladas": {
    "chain": "be945a45c8a421c8492f0df86147dc65",
    "id": "fdc4d01b-30f5-42a6-b217-5558c9e301a9",
    "points": {
      "5cb0ec9f-a86e-41dd-b8cf-32f259ab50a3": "ce241e920cd4efe2cb15065001122916",
      "81d55e9e-6065-4472-88cb-fe8702bd1b9f": "319fc63221e00ed1a051fb0144bc47e2",
      "9865b797-74f1-423d-8009-dda607172919": "cc6d117ba71325697576c0e86337b2c9",
      "a3f0e72a-3bb0-4ce8-af53-262c633223f3": "faa243c23899b67a28863bf09e907db1"
    }
  },
  "LT/ali-sokoladine": {
    "chain": "ab6daf42ec040649e51ae64a97bf6afd",
    "id": "9552d1f6-3f13-4c40-ad21-2fe259c3e1cf",
    "points": {
      "55966a84-37de-4f1f-9559-c253cb8f40a5": "e21a6a7d8b2ca80fde2f9b8726163eff",
      "859f4de2-11f7-42da-a885-7ea39c6e8ca1": "49805341d6837a4ffd96d541d4ffcb93",
      "a3fa4ec8-2c62-4ee0-9905-9dd66ba3662d": "29e3853ba7d0ea976164dececa14b013",
      "dc4f01d9-85f0-46f1-90fd-b9cf2730f32b": "c00ae141ce0c9543224d4dfd17461b6e",
      "f3aefe57-106c-43cb-9f2b-02a9f64f289f": "a823e6b3b5d3e8514f5a2b61ff7a40a3"
    }
  },
  "MD/dulcinella": {
    "chain": "57e1e0e5433ae906633486b0d1a5ed8b",
    "id": "54e8ca82-5728-4016-9b74-fdf0b8d5a338",
    "points": {
      "044d0855-b8a8-4234-87e3-b8e704137446": "fb2e20013735e86d05b476b1823d0bd6",
      "23de5cba-f5f7-43f1-9147-dbb8ffae42e7": "20ca4747f8f60876d531f2a03ed95162",
      "333e24df-028f-4f94-85ef-9c4c47fb098c": "6c71fb8aec7a113405985a0cb36c5dbd",
      "75b8b8c6-f87d-467f-ae18-a8b9e8cd3a2c": "0c65eb65debacc8819862e2c758db2aa",
      "8f889cfd-1f7a-457e-a180-8799d6aef55a": "61244713df912665aa35e3e198b2fc39",
      "acf92eb2-6055-4713-a49a-df4dfa9bd4e7": "0bc32f97be177ddfab1542dcacd47d31"
    }
  },
  "MD/dulcinella-moldova": {
    "chain": "88666e1c51bc82c400a8499bf3fa02c1",
    "id": "8c79b014-b48c-4635-bcb5-c520779544ca",
    "points": {
      "07b8ea4b-a2fa-4f40-a89c-be142ed99e6d": "22a3c441649adeaf8eafe39f9bc8126a",
      "0dc3ce5a-e9b6-42ea-9aff-d7f010f4c5b1": "1ada9fd4e06b8768b337d9e7600c9948",
      "1132fdf4-f8f7-48c8-b09f-409c7eac4683": "7949bab34e812a931fad38c10cd5e378",
      "1970f263-3ffc-4472-8eef-55aa58a8ade3": "04baa993f776260596e2c227f012d203",
      "2b393121-292f-4377-8192-a841fc10bb59": "4bdc38bca463ec22ba5fe9590ce3b22c",
      "3ca4a123-c397-4a27-bb3f-36086e6cf822": "eb98d341090b9ffdb85fd390a2548a7c",
      "3f60b517-1a4b-426a-b5f1-b98ad834a0ff": "5640d62f455e185405573860e2565b24",
      "472637a0-8d96-4ef8-83a1-ed635a993b2e": "56c552e96fb1d0f79ccbfbdf53ae6539",
      "4ad5a32b-5ae3-4f14-9130-32d17e0bed4e": "b3f1aebdfe158b7d77a4fbe443b38310",
      "52dd32c4-d8f4-474c-9f1f-88896686cf67": "d57e7d258b4b1ffd3304d8ff94903950",
      "56edd886-7014-4287-9398-f7f6d3806e43": "052b2ead5d9014bfa533a45983c1b6bc",
      "7789ecba-5ef6-49be-a377-4eb95a7dbfb7": "5fcc8a453b6bf52c55e3dee756f9c9e7",
      "7dd469fa-6d38-4db5-823d-c8bb0fd344f6": "c860338bf34dfd28bdbccf98137f91e2",
      "921ccef3-4cd8-42eb-9e01-26f18a2de76d": "c7350cda550cdc63c0f25a75abd84499",
      "bf838f50-c9c3-47ab-9c75-fc218c59ff00": "c1252fdb5f4dac3f4a30ac42b3c7c23e",
      "c52d9f44-99fa-4bd5-bdb6-644ea809d3aa": "534c5dae895176bc9935b3f362c3ad57",
      "c59c135c-dcac-48b5-9855-1da05aaa078b": "6334a78000784566369cc7ff0f126a95",
      "d133efca-bfed-437d-a226-35d17cb26da2": "a743107bdaac6968343b8a215d9d5b77",
      "e41cbeab-f2ff-42dc-b96b-7d5b41b6b954": "22016b51b9cce51aabd1c09539376a50",
      "e6814eaa-16b7-4b78-abb8-8493f7911121": "dd26ce2cef23c6f97e18bb21449ecc8d",
      "e7dcf053-5f79-4208-b6a9-ea57e09069aa": "94b706104dab2a2c9700dff0a936ce10",
      "eb83b270-a43c-4474-ac8a-26e5d6fa38e1": "89d15491d5c8558ea18dc057d26f8c4e",
      "f5502605-9072-4e04-8e76-bd251a09c040": "a866ee5ebaa5382eb595f79bcafde63e",
      "f78cd600-7487-4daa-910e-3acef6dfe764": "b632bc059f2d65ec61933240edbe2212",
      "ff27429b-93ed-4f9e-aaa2-279b3f33a968": "0c27691cac6af0adc14a563e1f5f7863"
    }
  },
  "PL/karmello-chocolatier": {
    "chain": "88566bccfe36cec116b28d1673239a8e",
    "id": "84dd4819-0b5f-4672-b8c9-7870f63bd8c7",
    "points": {
      "0ebebce4-4008-49d5-8dcc-f6deadb2989d": "57b6b9295a348279c566fc31c8b290f6",
      "1671716d-1bbb-41a5-8e7e-453586c12857": "55db9c4fa5db541d88cfaf036a8cf137",
      "27f87c24-ce07-42d0-9fec-d2f1ef8e0c02": "5b0894df831c3acfd0a107d040724ba9",
      "2b12122d-28d1-496a-b9c4-5cc483ef8edc": "e51886e3a1af8e461e2374db761d5fc4",
      "2fc89ba5-13ff-4529-b123-7ea72f31a8a8": "62e866a9c8ec5c6dd99ba1a7ed2682d7",
      "32510977-9629-40f4-8727-3ad9cd24169a": "d072983c3526d89bdb2474f0b8c10f47",
      "326983be-75e9-4949-8b83-7741a9a4560e": "7511ebe9eda62c8255e9c5706bd36c69",
      "33d4e447-9141-46a1-b5e8-aba52b94b711": "d013c91e99f05594dba3ac6de82a9078",
      "3e03ada8-2f54-47db-8a69-f5460a951ecd": "1340f334c44e06ebf92577a663fa01a5",
      "52298ff3-6c73-43bf-9b27-094632d3950a": "310edccf444314505a333de45643f173",
      "531b09c0-f707-41a5-a14b-bd0a6374e10b": "80578fa788ae9aa38bfd20300d69a1eb",
      "5b98a8f2-c245-49dc-b7ae-92b4cc8794ea": "8d105cece9884db860240bd37750ebcb",
      "674f0c16-5571-4a29-b0aa-b83393b6bdc6": "42d83fa3db7a808f0e2fe9b6342952a7",
      "689d4324-ca31-4487-b140-d10dc2e5a31c": "874d47afe42e60127ee4f03cc7530c36",
      "68a315ed-f47f-43b8-bf4e-1152cc0f47b6": "1a17644389f9e2d6a8e6a62d971bad4a",
      "770e2b9f-1e37-4592-897a-be18e036391d": "e234a0c41ac6ce09c547a1de40d29072",
      "7858d1ea-542f-4a19-9aa5-413a7d22931a": "644ef49f653336da5f31c1df8c7f3887",
      "8cf9893a-deb9-4f39-9b81-a8a0797900e1": "76a527d1e681c34c386e4e99672947ba",
      "98a69310-35c3-4bf5-a5b5-e3e0ba71fb3f": "d2fd9705131133af64ec668f89a37e62",
      "a06b8673-7946-42de-b516-38aeaeb18cf4": "15ac6a37dec1ac0bad03b34e3782d855",
      "a966f9cf-de1b-423e-b6cb-7eb2e0d53e90": "fc236b9d0432d569d9988979ed8fa8e5",
      "ac0dc6ea-00d8-4d4c-8a07-e628eb9f4e4f": "3ce45d30a98887d3f4b405cdeaeaef3c",
      "b6686512-aa1c-46df-b270-378fe27dac89": "9247b42474da4ce85cbd58f3c65523e7",
      "c5e4d203-60bf-466a-ae7e-90d91418fcb8": "4797a16d6bc317dea51564bad698de7a",
      "d5a7138c-681c-40b5-920f-1fa774e62d58": "81f998ea756afbe287d673d338913dcd",
      "d7022c56-a2a0-47f2-b3af-8c150b4744b1": "83f153acc8b3e7afff3fd5cdc139f47c",
      "d7d15a8b-a7a5-4a7f-a66b-fbe68686a3d5": "bf4562300f16ec408ccf9dfc20646375",
      "d83c5876-14c4-4405-940b-6c2d93768a08": "c96ff5d03b0834029681e3a7eaae11ae"
    }
  },
  "PL/lindt": {
    "chain": "dcc037cc6105a2fcb1bf2f026fcfd886",
    "id": "1ebc3744-83ed-45c3-9eca-7a1f152b0fb1",
    "points": {
      "0f23398e-6ef4-458b-8163-c713d6b1b557": "0d2e3fd8110eaad186e3d3f2f72d9096",
      "1d1494da-6444-409b-9bb8-d14f1af792ec": "b5c00b0262bf230a883a55b425aa9028",
      "2eadbad5-3dcb-4564-a2db-af554c309691": "b83ad25c7d904df0990729ae0b004ad7",
      "2f734db9-4cf7-4a1e-8273-38978c642c57": "c8e9ee6e83e64d1e4700c37b5a0c3cd8",
      "3042d997-0894-492e-9750-2ecbdc90c89f": "35549d3f80d4816e175e1c456a8b28e1",
      "31878126-87f1-4ebb-8a4c-a5c92a9f8f02": "0a689fc6e03ae931219c4508b890356d",
      "33d52d2c-0c12-46eb-8a99-be19161157f9": "5ec198653bf2e6127894e00f75cecff0",
      "382abc4c-4c29-4d99-ac1a-574764d633de": "455119e2159ee3854bd102a5907b6897",
      "38f8f819-bf51-4b0e-a501-08d12f829e69": "fb82f23b868ac4bc72b71cfb818c42ac",
      "4beff425-9d76-44e2-9749-90e42fe1614b": "0228a1e162db1d878d015ff1c1579aa8",
      "5131441a-6662-466c-a492-3aac7a2946d2": "4f1ac5a0c9c9227c243913a70290ca08",
      "663d9162-068e-41f1-87dc-c2df93b0615c": "88726c83bb95d86a8b1a0508a847210a",
      "6651ae21-52cb-4979-a63d-0dcb01961ae3": "85898061185fd5e75a233a488c87db56",
      "66bc97f7-cca8-46f3-8108-adfe3d913652": "0022ee9aaff162e2079b290107dc8990",
      "6d77bc46-0ae9-4981-beb5-3c1dfa46f270": "625049beb06d6b941ec18adb57cee026",
      "91403531-2eac-4343-84d7-d516605972a5": "d21e89dc02be80505dd2744780ee58a6",
      "941aa2e5-41e2-4390-9c9b-7e557ac32909": "bfc2ff5fca4b996e7ba8c654f18e1593",
      "98f24ba5-c1a0-4ca8-aca9-628e883af337": "6d8804c027207536efc32708110a1858",
      "a2313ec2-76d7-4da3-944d-6ef42533a197": "303b02050764aa25944f0a11f7b5ca4a",
      "a5607fec-50a8-46de-9a99-2ddc953e1047": "fb25766de995997244dbb747fc35a7cf",
      "aab9b0fa-4999-43cd-8164-1b2cd68cd2c6": "d50dc77beecf796c00fd00d6cd62b718",
      "bac465ea-f203-4c25-9d8c-336c52ec5390": "dbfee2dccdba990eaa38321abc18ec8b",
      "d7b45d1f-21eb-4eb2-8fb2-f555393a5224": "fbdb56e35b6b1f4dc3530076c94c20c7",
      "ee20270c-eacc-4bff-aa2f-107ae00beb52": "b20a76c7158de0d92b6b264430f6e5a9",
      "fe4f829f-13f6-4b6e-b90a-1bf5ad656b03": "5d3400062dbf7d7142fac106a317a408"
    }
  },
  "PL/pijalnia-czekolady-e-wedel-rynek-g-o": {
    "chain": "d5bb2101679e03dae979b37fe26cb139",
    "id": "c35f02c1-d6a8-4054-8764-17a50279be7e",
    "points": {
      "0231a788-9a37-452c-a97e-fd766df363c4": "9fc600a535ca89def7d7783f3685c7ff",
      "0ae855a0-56c2-410a-b920-8cbda1685992": "50d732e6bdec8f05dc0336ae2479d962",
      "0b18097b-229f-4394-931c-cb4e8cdf44dd": "c6c6f84a636f0d0a7ef179baed7627f4",
      "19419151-5ac2-4034-8f1b-472288fc356a": "b2fcf43c6507c81f27cf40e7bb88f476",
      "1cb4db6d-3014-4e84-83c4-5ab3599951b5": "27474f9583cfe7486b127ad77be1e02b",
      "217ac60b-088c-4977-99a8-84f84a2a196d": "54009b81a64672afbf64bd9e4fd0f342",
      "22cd648c-072d-4290-a7d3-cb6b463021fe": "71ad946fd5062850f8a20bc7f7eb75b1",
      "2d42867d-53d5-4c68-9b0a-2d10d874370b": "cdcab78313db3407d825c48eaf893d89",
      "2ef8bfbc-ccde-46b9-b98c-057fb39623f0": "9c7da074467a49ff41f749e3a1635c68",
      "30675b96-400d-4cee-97cd-1140eff2195a": "a4a3435aade2d7fcb88092e58998ecff",
      "49257617-def3-4681-9b89-62a51faef321": "d5d3f521f9de8dbe2c8a929853f00489",
      "4a590f88-2e77-48cd-9dc7-5260505840d9": "78d8f9eec67b8e431f127f7f0638e30b",
      "4ad06f7d-8d4d-46c6-8be8-0932411dda41": "2fcf0596cbf93a7e1093678d93bee246",
      "5dbd1917-9059-4cbb-83d0-58b28e62dfef": "91922b0c3036348ad83a371efae7d8c5",
      "831abaa2-f4cb-45da-bb95-1ea6c3640d52": "80c348f2bc66d0b24615ba0658220a04",
      "84def568-04d6-4219-ad1e-3a842d664a4e": "4ab58c28cda4865a0f68a00cf572e836",
      "864e9fac-7d0c-4a0c-8bfc-969959ac81ea": "5257d0c3a0b3cf6640d1b4bac6482c18",
      "87100d29-0d5c-48f4-a5c4-747a5e8adb8f": "ba44ee1141db695cc0d94555e01dbc89",
      "8e5d6c51-b5eb-41fe-ba4f-667bb2c17b30": "af3bac37e6c60b14e50181856eee00b8",
      "91df0d39-8b7f-4b11-b458-638dcc34eabe": "1dce14af094756b412c36aaf5bbf2856",
      "94621d80-a029-4e55-86a3-fa00f81bcf74": "45a7fa3bb2271e228ddea105f12f2ce9",
      "98ebfa77-422b-41f9-98f6-a4f34608687d": "b9bb517155e1a1502465aa1ae4fb7df2",
      "9c588e72-8e39-4107-ac34-1ea34c5b51d8": "989045b82b6defb92565bbfc3af87098",
      "b222ee81-573c-4493-af66-2383391f8127": "2d995e0f12c05fbfe38e398d3959b810",
      "cd07c70d-f09d-4221-ab39-e1340d8c2e45": "66b5ac697e64fc87dfe6ef168254f8c6",
      "cd39bdd5-e4ed-49a1-81d5-985bd395d09f": "61c2cee205400060edbbf42a1fbf71c1",
      "db2e1700-48ea-4665-984d-08e787a579dd": "1320eff1b064db5d4f1bdda2d9677526",
      "e36c13f6-ad09-4d2b-a414-09bb71724a6c": "9f7a403f92ad083d0b0ece04470afa85",
      "f4408bd2-08db-4e8a-abd2-f7dc4b25727e": "b30e67e724e6798dd1d3fdf910f41714",
      "f7a11dc9-38a1-4f7c-8332-8a97f36e713f": "89f854a890d5f733a6a9891447cfe7d4",
      "fe9880c3-59f1-4968-83ea-53c61625f407": "9d457f789139cd8ffe6bbd3534da95a6"
    }
  }
}
$targets$::jsonb;
  target_key text;
  v_country text;
  v_chain text;
  target jsonb;
  expected_points jsonb;
  actual_chain text;
  actual_points jsonb;
  removed integer;
  skipped text[] := '{}';
  caller_float_digits constant text := current_setting('extra_float_digits');
  caller_lock_timeout constant text := current_setting('lock_timeout');
begin
  if not exists (
    select 1 from jsonb_object_keys(targets) k
    where exists (select 1 from public.mkt_chains c
      where c.country = split_part(k, '/', 1) and c.key = substr(k, 4))
  ) then
    return;
  end if;

  perform set_config('lock_timeout', '5s', true);
  perform set_config('extra_float_digits', '3', true);
  -- Protect the CAS and logical references (some have no FK) from concurrent writes.
  -- Refuse after 5 seconds instead of waiting indefinitely for a collector/editor.
  lock table public.mkt_chains, public.mkt_locations, public.mkt_companies,
    public.mkt_prices, public.mkt_ratings, public.mkt_sources, public.mkt_editorial,
    public.mkt_candidates, public.mkt_facts in share row exclusive mode;

  for target_key in select jsonb_object_keys(targets) order by 1 loop
    v_country := split_part(target_key, '/', 1);
    v_chain := substr(target_key, 4);
    target := targets->target_key;
    expected_points := target->'points';
    if not exists (select 1 from public.mkt_chains where country=v_country and key=v_chain) then
      continue;
    end if;

    if exists (
      select 1 from public.mkt_chains where country=v_country and key=v_chain
        and (origin is not null or operator is not null or first_entry is not null or notes is not null or hist is not null)
    ) or exists (
      select 1 from public.mkt_locations where country=v_country and chain_key=v_chain
        and (source_kind <> 'overture' or verification <> 'unverified' or status <> 'open'
          or opened is not null or closed is not null or opened_estimated
          or placement is not null or format is not null or verification_note is not null)
    ) then
      raise warning 'manufacturer-shop chain % skipped: it has curated data, review before cleanup', target_key;
      continue;
    end if;

    select md5((to_jsonb(c)-'updated_at')::text) into actual_chain
      from public.mkt_chains c where country=v_country and key=v_chain;
    select coalesce(jsonb_object_agg(l.id::text,
      md5((to_jsonb(l)-array['first_seen_at','last_seen_at'])::text)), '{}'::jsonb)
      into actual_points from public.mkt_locations l where country=v_country and l.chain_key=v_chain;
    if actual_chain is distinct from (target->>'chain') or actual_points is distinct from expected_points then
      raise warning 'manufacturer-shop chain % skipped: its snapshot changed, review before cleanup', target_key;
      continue;
    end if;

    if exists (select 1 from public.mkt_prices where country=v_country and chain_key=v_chain)
      or exists (select 1 from public.mkt_companies where country=v_country and chain_key=v_chain)
      or exists (select 1 from public.mkt_sources where country=v_country and chain_key=v_chain)
      or exists (select 1 from public.mkt_ratings r
        where (r.country=v_country and r.chain_key=v_chain) or expected_points ? r.location_id::text)
      or exists (select 1 from public.mkt_editorial e
        where (e.country=v_country and strpos(e.payload::text,v_chain)>0)
          or exists (select 1 from jsonb_object_keys(expected_points) p(id) where strpos(e.payload::text,p.id)>0))
      or exists (select 1 from public.mkt_candidates c
        where (c.country=v_country and strpos(c.payload::text,v_chain)>0)
          or expected_points ? c.target_id::text
          or exists (select 1 from jsonb_object_keys(expected_points) p(id) where strpos(c.payload::text,p.id)>0))
      or exists (select 1 from public.mkt_facts f
        where (f.country=v_country and strpos(concat_ws(' ',f.text,f.value,f.source),v_chain)>0)
          or exists (select 1 from jsonb_object_keys(expected_points) p(id)
            where strpos(concat_ws(' ',f.text,f.value,f.source),p.id)>0)) then
      raise warning 'manufacturer-shop chain % skipped: it has references, review before cleanup', target_key;
      continue;
    end if;

    delete from public.mkt_locations l
      where l.country=v_country and l.chain_key=v_chain and expected_points ? l.id::text;
    get diagnostics removed = row_count;
    if removed <> (select count(*) from jsonb_object_keys(expected_points)) then
      raise exception 'manufacturer-shop chain % location count changed', target_key;
    end if;
    delete from public.mkt_chains where country=v_country and key=v_chain and id=(target->>'id')::uuid;
    get diagnostics removed = row_count;
    if removed <> 1 then raise exception 'manufacturer-shop chain % identity changed', target_key; end if;
    raise notice 'manufacturer-shop chain % removed', target_key;
  end loop;
  -- Canonical CAS rendering and the bounded lock wait belong only to this repair.
  -- An error is deliberately left to the caller's transaction/savepoint rollback.
  perform set_config('extra_float_digits', caller_float_digits, true);
  perform set_config('lock_timeout', caller_lock_timeout, true);
end
$migration$;
