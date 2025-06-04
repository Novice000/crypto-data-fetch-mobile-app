import {
	View,
	Text,
	TextInput,
	ScrollView,
	TouchableOpacity,
	Alert,
	ActivityIndicator,
	Platform,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, CardTitle, CardHeader, CardFooter, CardContent } from "components/ui/card";
import { Checkbox } from "components/ui/checkbox";
import {
	documentDirectory,
	createDownloadResumable,
	StorageAccessFramework,
} from "expo-file-system";
import { useColorScheme } from "lib/useColorScheme";
import { shareAsync } from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

const baseurl = "https://fetch-crypto-data-fastapi.onrender.com";

function Home() {
	const [ticker, setTicker] = useState<string>("");
	const [isDownloading, setIsDownloading] = useState<boolean>(false);
	const [downloadLocation, setDownloadLocation] = useState<"internal" | "downloads" | "share">(
		"downloads"
	);
	const { isDarkColorScheme } = useColorScheme();
	const [params, setParams] = useState({
		tickers: "",
		price: true,
		market_cap: false,
		market_cap_abbrv: true,
		volume_24h: true,
		total_supply: false,
		circulating_supply: false,
		supply_percent: true,
		volume_change_24h: false,
		token_address: false,
		market_cap_dominance: false,
	});

	// Toast-like alert function
	const showToast = (title: string, message: string, type: "success" | "error" = "error") => {
		Alert.alert(title, message, [{ text: "OK" }]);
	};

	// Build URL with proper encoding
	const buildDownloadUrl = () => {
		const queryParams = new URLSearchParams();

		// Add tickers
		if (params.tickers) {
			queryParams.append("tickers", params.tickers);
		}

		// Add boolean parameters
		Object.entries(params).forEach(([key, value]) => {
			if (key !== "tickers") {
				queryParams.append(key, value.toString());
			}
		});

		return `${baseurl}/api/data/download?${queryParams.toString()}`;
	};

	function addTicker() {
		if (!ticker.trim()) {
			showToast("Invalid Input", "Please enter a valid ticker symbol");
			return;
		}

		// Check for duplicates
		const existingTickers = params.tickers.split(",").filter((t) => t.length > 0);
		if (existingTickers.includes(ticker.toUpperCase())) {
			showToast("Duplicate Ticker", "This ticker has already been added");
			return;
		}

		setParams((prev) => ({
			...prev,
			tickers:
				prev.tickers === ""
					? ticker.toUpperCase()
					: prev.tickers + "," + ticker.toUpperCase(),
		}));
		setTicker("");
	}

	function removeTicker(tickerToRemove: string) {
		const updatedTickers = params.tickers
			.split(",")
			.filter((t) => t !== tickerToRemove)
			.join(",");

		setParams((prev) => ({ ...prev, tickers: updatedTickers }));
	}

	function reset() {
		setParams({
			tickers: "",
			price: true,
			market_cap: false,
			market_cap_abbrv: true,
			volume_24h: true,
			total_supply: false,
			circulating_supply: false,
			supply_percent: true,
			volume_change_24h: false,
			token_address: false,
			market_cap_dominance: false,
		});
		setTicker("");
	}

	async function download() {
		// Validation
		if (!params.tickers.trim()) {
			showToast("No Tickers", "Please add at least one ticker symbol before downloading");
			return;
		}

		// Check if at least one data field is selected
		const dataFields = Object.entries(params).filter(
			([key, value]) => key !== "tickers" && value
		);
		if (dataFields.length === 0) {
			showToast(
				"No Data Fields",
				"Please select at least one data field to include in the download"
			);
			return;
		}

		setIsDownloading(true);

		try {
			const downloadUrl = buildDownloadUrl();
			console.log("Download URL:", downloadUrl);

			const fileName = `crypto_data_${new Date().toISOString().split("T")[0]}.zip`;
			let downloadPath: string;

			// Choose download strategy based on selected location
			switch (downloadLocation) {
				case "downloads":
					downloadPath = await downloadToDownloadsFolder(downloadUrl, fileName);
					break;
				case "share":
					downloadPath = await downloadAndShare(downloadUrl, fileName);
					break;
				default:
					downloadPath = await downloadToInternal(downloadUrl, fileName);
			}

			console.log("Successfully downloaded to:", downloadPath);
			showToast("Download Complete", `File saved successfully!`, "success");
		} catch (error) {
			console.error("Download error:", error);
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			showToast("Download Failed", `Error: ${errorMessage}`);
		} finally {
			setIsDownloading(false);
		}
	}

	// Download to device's Downloads folder (Android) or user-accessible location
	async function downloadToDownloadsFolder(url: string, fileName: string): Promise<string> {
		if (Platform.OS === "android") {
			try {
				// Request permissions for Android
				const { status } = await MediaLibrary.requestPermissionsAsync();
				if (status !== "granted") {
					throw new Error("Storage permission denied");
				}

				// Use Storage Access Framework for Android 10+
				const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
				if (!permissions.granted) {
					throw new Error("Directory access permission denied");
				}

				// Download to temporary location first
				const tempPath = documentDirectory + fileName;
				const downloadObj = createDownloadResumable(url, tempPath);
				const result = await downloadObj.downloadAsync();

				if (!result?.uri) {
					throw new Error("Download failed");
				}

				// Copy to user-selected directory
				const finalUri = await StorageAccessFramework.createFileAsync(
					permissions.directoryUri,
					fileName,
					"application/zip"
				);

				await StorageAccessFramework.writeAsStringAsync(
					finalUri,
					await StorageAccessFramework.readAsStringAsync(result.uri, {
						encoding: "base64",
					}),
					{ encoding: "base64" }
				);

				return finalUri;
			} catch (error) {
				// Fallback to internal storage
				console.warn("Downloads folder access failed, using internal storage:", error);
				return await downloadToInternal(url, fileName);
			}
		} else {
			// iOS - download to app's Documents directory (accessible via Files app)
			return await downloadToInternal(url, fileName);
		}
	}

	// Download and immediately share the file
	async function downloadAndShare(url: string, fileName: string): Promise<string> {
		const tempPath = documentDirectory + fileName;
		const downloadObj = createDownloadResumable(url, tempPath);
		const result = await downloadObj.downloadAsync();

		if (!result?.uri) {
			throw new Error("Download failed");
		}

		// Share the file immediately
		await shareAsync(result.uri, {
			mimeType: "application/zip",
			dialogTitle: "Save Crypto Data File",
			UTI: "public.zip-archive",
		});

		return result.uri;
	}

	// Download to internal app directory
	async function downloadToInternal(url: string, fileName: string): Promise<string> {
		const downloadPath = documentDirectory + fileName;
		const downloadObj = createDownloadResumable(url, downloadPath);
		const result = await downloadObj.downloadAsync();

		if (!result?.uri) {
			throw new Error("Download failed");
		}
		return result.uri;
	}

	const formatFieldName = (key: string) => {
		return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
	};

	return (
		<SafeAreaView
			className={`${
				isDarkColorScheme ? "bg-gray-900 text-white" : "bg-gray-50"
			} h-screen flex flex-col items-center justify-start`}>
			<ScrollView>
				<Card
					className={`${
						isDarkColorScheme
							? "bg-gray-800 border-gray-700"
							: "bg-white border-gray-200"
					} w-full max-w-md shadow-lg`}>
					<CardHeader className="pb-4">
						<CardTitle
							className={`text-center text-xl font-bold ${
								isDarkColorScheme ? "text-white" : "text-gray-900"
							}`}>
							Crypto Data Downloader
						</CardTitle>
						<Text
							className={`text-center text-sm ${
								isDarkColorScheme ? "text-gray-300" : "text-gray-600"
							}`}>
							Add tickers and select data fields
						</Text>
					</CardHeader>

					<CardContent className="gap-4">
						{/* Ticker Input */}
						<View className="w-full">
							<Text
								className={`mb-2 font-medium ${
									isDarkColorScheme ? "text-gray-200" : "text-gray-700"
								}`}>
								Add Ticker Symbol
							</Text>
							<View className="flex flex-row">
								<TextInput
									className={`flex-1 h-12 px-4 rounded-l-lg border ${
										isDarkColorScheme
											? "bg-gray-700 border-gray-600 text-white"
											: "bg-white border-gray-300 text-gray-900"
									}`}
									value={ticker}
									onChangeText={setTicker}
									placeholder="e.g., BTC, ETH"
									placeholderTextColor={isDarkColorScheme ? "#9CA3AF" : "#6B7280"}
									autoCapitalize="characters"
									onSubmitEditing={addTicker}
								/>
								<TouchableOpacity
									className="bg-blue-600 items-center justify-center h-12 px-4 rounded-r-lg"
									onPress={addTicker}>
									<Text className="text-white font-medium">Add</Text>
								</TouchableOpacity>
							</View>
						</View>

						{/* Selected Tickers */}
						{params.tickers !== "" && (
							<View
								className={`border rounded-lg p-3 ${
									isDarkColorScheme
										? "border-gray-600 bg-gray-700"
										: "border-gray-200 bg-gray-50"
								}`}>
								<Text
									className={`mb-2 font-medium ${
										isDarkColorScheme ? "text-gray-200" : "text-gray-700"
									}`}>
									Selected Tickers ({params.tickers.split(",").length})
								</Text>
								<View className="flex flex-row flex-wrap gap-2">
									{params.tickers.split(",").map((tickerItem, idx) => (
										<TouchableOpacity
											key={tickerItem + idx}
											onPress={() => removeTicker(tickerItem)}
											className="bg-blue-100 px-3 py-1 rounded-full flex flex-row items-center">
											<Text className="text-blue-800 text-sm font-medium mr-1">
												{tickerItem}
											</Text>
											<Text className="text-blue-600 text-sm">×</Text>
										</TouchableOpacity>
									))}
								</View>
							</View>
						)}

						{/* Download Location Selection */}
						<View>
							<Text
								className={`mb-3 font-medium ${
									isDarkColorScheme ? "text-gray-200" : "text-gray-700"
								}`}>
								Download Location
							</Text>
							<View className="space-y-2">
								<TouchableOpacity
									className={`flex flex-row items-center p-3 rounded-lg border ${
										downloadLocation === "downloads"
											? isDarkColorScheme
												? "bg-blue-900 border-blue-600"
												: "bg-blue-50 border-blue-300"
											: isDarkColorScheme
											? "border-gray-600"
											: "border-gray-200"
									}`}
									onPress={() => setDownloadLocation("downloads")}>
									<View
										className={`w-4 h-4 rounded-full border-2 mr-3 ${
											downloadLocation === "downloads"
												? "bg-blue-600 border-blue-600"
												: isDarkColorScheme
												? "border-gray-500"
												: "border-gray-300"
										}`}
									/>
									<View className="flex-1">
										<Text
											className={`font-medium ${
												isDarkColorScheme
													? "text-gray-200"
													: "text-gray-900"
											}`}>
											Downloads Folder
										</Text>
										<Text
											className={`text-xs ${
												isDarkColorScheme
													? "text-gray-400"
													: "text-gray-500"
											}`}>
											{Platform.OS === "android"
												? "Save to Downloads folder"
												: "Save to Files app"}
										</Text>
									</View>
								</TouchableOpacity>

								<TouchableOpacity
									className={`flex flex-row items-center p-3 rounded-lg border ${
										downloadLocation === "share"
											? isDarkColorScheme
												? "bg-blue-900 border-blue-600"
												: "bg-blue-50 border-blue-300"
											: isDarkColorScheme
											? "border-gray-600"
											: "border-gray-200"
									}`}
									onPress={() => setDownloadLocation("share")}>
									<View
										className={`w-4 h-4 rounded-full border-2 mr-3 ${
											downloadLocation === "share"
												? "bg-blue-600 border-blue-600"
												: isDarkColorScheme
												? "border-gray-500"
												: "border-gray-300"
										}`}
									/>
									<View className="flex-1">
										<Text
											className={`font-medium ${
												isDarkColorScheme
													? "text-gray-200"
													: "text-gray-900"
											}`}>
											Share/Save As
										</Text>
										<Text
											className={`text-xs ${
												isDarkColorScheme
													? "text-gray-400"
													: "text-gray-500"
											}`}>
											Choose where to save or share
										</Text>
									</View>
								</TouchableOpacity>

								<TouchableOpacity
									className={`flex flex-row items-center p-3 rounded-lg border ${
										downloadLocation === "internal"
											? isDarkColorScheme
												? "bg-blue-900 border-blue-600"
												: "bg-blue-50 border-blue-300"
											: isDarkColorScheme
											? "border-gray-600"
											: "border-gray-200"
									}`}
									onPress={() => setDownloadLocation("internal")}>
									<View
										className={`w-4 h-4 rounded-full border-2 mr-3 ${
											downloadLocation === "internal"
												? "bg-blue-600 border-blue-600"
												: isDarkColorScheme
												? "border-gray-500"
												: "border-gray-300"
										}`}
									/>
									<View className="flex-1">
										<Text
											className={`font-medium ${
												isDarkColorScheme
													? "text-gray-200"
													: "text-gray-900"
											}`}>
											App Storage
										</Text>
										<Text
											className={`text-xs ${
												isDarkColorScheme
													? "text-gray-400"
													: "text-gray-500"
											}`}>
											Internal app directory (harder to find)
										</Text>
									</View>
								</TouchableOpacity>
							</View>
						</View>

						{/* Data Fields */}
						<View>
							<Text
								className={`mb-3 font-medium ${
									isDarkColorScheme ? "text-gray-200" : "text-gray-700"
								}`}>
								Select Data Fields
							</Text>
							<View className="flex flex-row flex-wrap">
								{Object.entries(params).map(([key, value]) => {
									if (key !== "tickers") {
										return (
											<View
												className="w-1/2 mb-2"
												key={key}>
												<View className="flex flex-row items-center">
													<Checkbox
														checked={value as boolean}
														onCheckedChange={(checked) =>
															setParams((prev) => ({
																...prev,
																[key]: checked,
															}))
														}
														className="mr-2"
													/>
													<Text
														className={`text-sm flex-1 ${
															isDarkColorScheme
																? "text-gray-300"
																: "text-gray-600"
														}`}>
														{formatFieldName(key)}
													</Text>
												</View>
											</View>
										);
									}
								})}
							</View>
						</View>
					</CardContent>

					<CardFooter className="pt-4">
						<TouchableOpacity
							className={`w-full h-12 rounded-lg items-center justify-center ${
								isDarkColorScheme ? "bg-gray-600" : "bg-gray-200"
							}`}
							onPress={reset}>
							<Text
								className={`font-medium ${
									isDarkColorScheme ? "text-gray-200" : "text-gray-700"
								}`}>
								Reset All
							</Text>
						</TouchableOpacity>
					</CardFooter>
				</Card>

				{/* Download Button */}
				<View className="mt-8 items-center">
					<TouchableOpacity
						className={`items-center justify-center rounded-full h-32 w-32 ${
							isDownloading ? "bg-gray-400" : "bg-gray-800 shadow-lg"
						}`}
						onPress={download}
						disabled={isDownloading}>
						{isDownloading ? (
							<View className="items-center">
								<ActivityIndicator
									size="large"
									color="white"
								/>
								<Text className="text-white text-sm mt-2">Downloading...</Text>
							</View>
						) : (
							<View className="items-center">
								<Text className="text-white text-lg font-bold">📥</Text>
								<Text className="text-white font-medium text-center px-2">
									Download Data
								</Text>
							</View>
						)}
					</TouchableOpacity>

					{params.tickers && (
						<Text
							className={`text-center text-xs mt-2 ${
								isDarkColorScheme ? "text-gray-400" : "text-gray-500"
							}`}>
							{params.tickers.split(",").length} ticker(s) •{" "}
							{
								Object.entries(params).filter(
									([key, value]) => key !== "tickers" && value
								).length
							}{" "}
							field(s)
						</Text>
					)}
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

export default Home;