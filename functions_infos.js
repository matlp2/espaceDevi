

functions_infos = {
	count: {
		nb_columns_min: 0,
		nb_columns_max: 0,
		parameters:[],
		positive_result_default_value: true,
		group_by_allowed: true,
		sensibility_equals_to_1:true,
		clamp_result:false,
	},
	count_distinct: {
		nb_columns_min: 1,
		nb_columns_max: 5000,//float("inf"),
		parameters: [
			'columns'
		],
		positive_result_default_value: true,
		group_by_allowed: true,
		sensibility_equals_to_1:true,
		clamp_result:false,
	},
	quantile: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters:[
			'column',
			'quantile',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:true,
	},
	min: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:true,
	},
	max: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		clamp_result:true,
	},
	median: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:true,
	},
	sum: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:true,
	},
	average: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:true,
	},
	variance: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:false,
	},
	stdev: {
		nb_columns_min: 1,
		nb_columns_max: 1,
		parameters: [
			'column',
			'low',
			'high'
		],
		positive_result_default_value: false,
		group_by_allowed: true,
		sensibility_equals_to_1:false,
		clamp_result:false,
	},
}